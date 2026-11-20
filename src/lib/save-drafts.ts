/**
 * Saves the user's AI drafts into empty Buffer slots, as Buffer DRAFTS only (saveToDraft: true): nothing here can
 * schedule, publish or delete. Drafts go in through createContentItem, which writes one post per channel in a single
 * all-or-nothing call (developers.buffer.com/guides/content-items.md), so a week costs a few requests instead of one
 * per post. createContentItem is marked Experimental, so if Buffer rejects the mutation itself we fall back to one
 * createPost per draft with the same input.
 */
import { BufferApiError, bufferQuery } from "./buffer/client";
import { tooLong } from "./char-limits";
import { type LimitStatus } from "./buffer/posting-limits";
import { notSentReason, waitRefusal, type WaitRefusal } from "./buffer/not-sent";
import { MAX_ALIASES } from "./buffer/queries";
import type { OpenSlot } from "./open-slots";

type Query = typeof bufferQuery;

export type DraftInput = { slotId: string; text: string };
/** postId is Buffer's id for the draft, null when Buffer did not say; text is exactly what was saved, for reading edits back. */
export type SavedDraft = { slotId: string; channel: string; local: string; postId: string | null; network: string; text: string };
export type RefusedDraft = { slotId: string; reason: string };
/**
 * `waitUntil` is set when Buffer's request limit stopped the run before every draft was written: the drafts it stopped
 * are in `refused` with a reason saying nothing was sent, and can be tried again then (null when the time is unknown).
 */
export type SaveResult = { saved: SavedDraft[]; refused: RefusedDraft[]; requests: number; waitUntil?: Date | null };

const CONTENT_ITEM = `mutation ($input: CreateContentItemInput!) {
  createContentItem(input: $input) {
    __typename
    ... on CreateContentItemSuccess { content { id body { __typename ... on PostContent { posts { id channelId } } } } }
    ... on CreateContentItemFailure { message }
  }
}`;

const CREATE_POST = `mutation ($input: CreatePostInput!) {
  createPost(input: $input) {
    __typename
    ... on PostActionSuccess { post { id } }
    ... on MutationError { message }
  }
}`;


/** At most this many intended times are checked per save; all of them go in one request, one alias each. */
export const MAX_LIMIT_CHECKS = 12;

/**
 * Asks Buffer whether adding a post at each slot's time would go over the network's daily limit
 * (developers.buffer.com/reference.md, dailyPostingLimits: one intended time per call, channels from one
 * organization; X uses the busiest rolling 24 hours). Every (organization, time) pair is one aliased field of a
 * single request, as Buffer's guide allows several fields and up to 30 aliases in one query. Returns the slots that
 * would go over. A failed check blocks nothing (Buffer still enforces the limit when the post is due), except a wait
 * refusal, which is returned so the save stops before writing.
 */
async function slotsAtLimit(token: string, items: { slot: OpenSlot }[], q: Query): Promise<{ atLimit: Map<string, LimitStatus>; requests: number; wait: WaitRefusal | null }> {
  const groups = new Map<string, OpenSlot[]>();
  for (const { slot } of items) {
    const key = `${slot.organizationId}|${slot.at}`;
    groups.set(key, [...(groups.get(key) ?? []), slot]);
  }
  const atLimit = new Map<string, LimitStatus>();
  const checked = [...groups.values()].slice(0, Math.min(MAX_LIMIT_CHECKS, MAX_ALIASES));
  if (!checked.length) return { atLimit, requests: 0, wait: null };
  const decl = checked.map((_, i) => `$i${i}: DailyPostingLimitsInput!`).join(", ");
  const fields = checked.map((_, i) => `l${i}: dailyPostingLimits(input: $i${i}) { channelId isAtLimit limit scheduled sent }`).join(" ");
  const vars = Object.fromEntries(checked.map((slots, i) => [`i${i}`, { channelIds: [...new Set(slots.map((s) => s.channelId))], date: slots[0].at }]));
  try {
    const res = await q<Record<string, LimitStatus[] | undefined>>(token, `query (${decl}) { ${fields} }`, vars);
    checked.forEach((slots, i) => {
      for (const st of res[`l${i}`] ?? []) {
        if (!st.isAtLimit) continue;
        for (const s of slots) if (s.channelId === st.channelId) atLimit.set(s.id, st);
      }
    });
  } catch (e) {
    const wait = waitRefusal(e);
    if (wait) return { atLimit, requests: 1, wait };
    // Otherwise the pre-check is advisory; see above.
  }
  return { atLimit, requests: 1, wait: null };
}

/** One Buffer post input for a slot, always a draft and marked as written with AI. */
const postInput = (slot: OpenSlot, text: string) => ({
  channelId: slot.channelId,
  text,
  dueAt: slot.at,
  mode: "customScheduled",
  schedulingType: "automatic",
  saveToDraft: true,
  aiAssisted: true,
});

/**
 * Splits drafts into groups with at most one per channel, keeping time order: createContentItem allows at most one
 * variant per channel, so a week with two slots on one channel needs two content items.
 */
export function groupByChannel<T extends { slot: OpenSlot }>(items: T[]): T[][] {
  const groups: T[][] = [];
  for (const item of items) {
    // A content item belongs to one organization, so a group only takes posts from its own organization.
    const fits = groups.find((g) => g[0].slot.organizationId === item.slot.organizationId && !g.some((x) => x.slot.channelId === item.slot.channelId));
    if (fits) fits.push(item);
    else groups.push([item]);
  }
  return groups;
}

/** True when Buffer refused the createContentItem operation itself (removed, renamed or not allowed), not one post. */
function contentItemUnavailable(e: unknown): boolean {
  const m = e instanceof Error ? e.message : String(e);
  return /createContentItem|Cannot query field|Unknown type|not authorized|experimental/i.test(m);
}

/**
 * True when a write may have reached Buffer without an answer coming back: a network failure or a server error.
 * Buffer's own refusals (GraphQL errors, 4xx, 429) mean nothing was written.
 */
function outcomeUnknown(e: unknown): boolean {
  return !(e instanceof BufferApiError) || e.status >= 500;
}

const DRAFTS_AT = `query ($input: PostsInput!) { posts(input: $input, first: 50) { edges { node { id channelId status text dueAt } } } }`;

/**
 * After a write with no answer, asks Buffer which of these drafts exist now (one request), so a draft that was
 * created is reported as saved and the next fill does not write it twice. Returns post ids by slot id, or null when
 * Buffer cannot be asked either.
 */
async function readBack(token: string, items: { slot: OpenSlot; text: string }[], q: Query): Promise<Map<string, string> | null> {
  const times = items.map((i) => i.slot.at).sort();
  try {
    const data = await q<{ posts: { edges: { node: { id: string; channelId: string; status: string; text: string | null; dueAt: string | null } }[] } }>(token, DRAFTS_AT, {
      input: {
        organizationId: items[0].slot.organizationId,
        filter: { channelIds: [...new Set(items.map((i) => i.slot.channelId))], dueAt: { start: times[0], end: times.at(-1) } },
      },
    });
    const found = new Map<string, string>();
    for (const i of items) {
      const post = data.posts.edges.map((e) => e.node).find((p) =>
        p.channelId === i.slot.channelId && p.status === "draft" && (p.text ?? "").trim() === i.text && p.dueAt !== null && Date.parse(p.dueAt) === Date.parse(i.slot.at));
      if (post) found.set(i.slot.id, post.id);
    }
    return found;
  } catch {
    return null;
  }
}

type Ready = { slot: OpenSlot; text: string };

/** One saving run: what was saved and refused so far, the requests spent, and the wait that ended it, if any. */
type Run = {
  token: string;
  title: string;
  q: Query;
  saved: SavedDraft[];
  refused: RefusedDraft[];
  requests: number;
  /** False once Buffer said content items are unavailable: every later group goes post by post. */
  useContentItems: boolean;
  wait: WaitRefusal | null;
  groups: Ready[][];
};

/** Why a draft cannot be saved before Buffer is asked, or null when it can go. Platform facts only. */
function precheck(d: DraftInput, slot: OpenSlot, text: string, used: Set<string>): string | null {
  if (used.has(d.slotId)) return "Two drafts were given for the same slot; only the first was kept.";
  if (!text) return "The draft is empty.";
  if (!slot.organizationId) return "Refresh Queue Pilot once so it knows this channel's organization, then try again.";
  // Platform facts only (length, slot, organization, daily limit). The playbook is judged before this, by a model.
  const long = tooLong(slot.service, text);
  return long ? `Too long for ${slot.channel}: ${long}.` : null;
}

/** Splits drafts into those refused before any request and those ready to save, in slot order. */
function sortDrafts(drafts: DraftInput[], open: OpenSlot[]): { refused: RefusedDraft[]; ready: Ready[] } {
  const byId = new Map(open.map((s) => [s.id, s]));
  const refused: RefusedDraft[] = [];
  const ready: Ready[] = [];
  const used = new Set<string>();
  for (const d of drafts) {
    const slot = byId.get(d.slotId);
    const text = d.text.trim();
    if (!slot) {
      refused.push({ slotId: d.slotId, reason: "That slot is no longer empty, or is not in the next two weeks." });
      continue;
    }
    const reason = precheck(d, slot, text, used);
    if (reason !== null) refused.push({ slotId: d.slotId, reason });
    else {
      used.add(d.slotId);
      ready.push({ slot, text });
    }
  }
  ready.sort((a, b) => a.slot.at.localeCompare(b.slot.at));
  return { refused, ready };
}

/** After a write with no answer: the drafts Buffer has now count as saved, the rest are refused with why. */
function settleUnknown(run: Run, found: Map<string, string> | null, items: Ready[]): void {
  for (const g of items) {
    const postId = found?.get(g.slot.id);
    if (postId) run.saved.push({ slotId: g.slot.id, channel: g.slot.channel, local: g.slot.local, postId, network: g.slot.service, text: g.text });
    else run.refused.push({
      slotId: g.slot.id,
      reason: found ? "Buffer did not answer, and the draft is not in Buffer. Try again." : "Buffer did not answer and could not be checked. Check Buffer before trying again.",
    });
  }
}

/** Ends the run: this group's unsent drafts and every later group are reported as not sent. */
function stopAt(run: Run, w: WaitRefusal, unsent: { slot: OpenSlot }[], gi: number): void {
  run.wait = w;
  const reason = notSentReason(w);
  run.refused.push(...[...unsent, ...run.groups.slice(gi + 1).flat()].map((g) => ({ slotId: g.slot.id, reason })));
}

/**
 * Saves one channel group as one content item. "done" when the group is settled, "posts" when it should be retried
 * post by post, "stop" when Buffer said to wait.
 */
async function saveAsItem(run: Run, group: Ready[], gi: number): Promise<"done" | "posts" | "stop"> {
  try {
    run.requests++;
    const res = await run.q<{ createContentItem: { __typename: string; message?: string; content?: { body?: { posts?: { id: string; channelId: string }[] } } } }>(run.token, CONTENT_ITEM, {
      input: { organizationId: group[0].slot.organizationId, title: run.title.slice(0, 200), posts: group.map((g) => postInput(g.slot, g.text)) },
    });
    if (res.createContentItem.__typename === "CreateContentItemSuccess") {
      // One post per channel in a group, so the channel id names each post Buffer created.
      const posts = res.createContentItem.content?.body?.posts ?? [];
      run.saved.push(...group.map((g) => ({ slotId: g.slot.id, channel: g.slot.channel, local: g.slot.local, postId: posts.find((p) => p.channelId === g.slot.channelId)?.id ?? null, network: g.slot.service, text: g.text })));
      return "done";
    }
    // All or nothing: one bad post sinks the group. A single-post group already has its own reason; a bigger one
    // is retried post by post below, so each draft gets Buffer's answer for itself and the good ones are saved.
    if (group.length === 1) {
      run.refused.push({ slotId: group[0].slot.id, reason: res.createContentItem.message ?? "Buffer refused this draft." });
      return "done";
    }
    return "posts";
  } catch (e) {
    const w = waitRefusal(e);
    if (w) { stopAt(run, w, group, gi); return "stop"; }
    if (outcomeUnknown(e) && !contentItemUnavailable(e)) {
      run.requests++;
      settleUnknown(run, await readBack(run.token, group, run.q), group);
      return "done";
    }
    if (!contentItemUnavailable(e)) {
      run.refused.push(...group.map((g) => ({ slotId: g.slot.id, reason: e instanceof Error ? e.message : "Buffer could not be reached." })));
      return "done";
    }
    run.useContentItems = false;
    return "posts";
  }
}

/** Saves one channel group post by post, stopping the run when Buffer says to wait. */
async function saveEachPost(run: Run, group: Ready[], gi: number): Promise<void> {
  for (const [i, g] of group.entries()) {
    try {
      run.requests++;
      const res = await run.q<{ createPost: { __typename: string; message?: string; post?: { id: string } } }>(run.token, CREATE_POST, { input: postInput(g.slot, g.text) });
      if (res.createPost.__typename === "PostActionSuccess") run.saved.push({ slotId: g.slot.id, channel: g.slot.channel, local: g.slot.local, postId: res.createPost.post?.id ?? null, network: g.slot.service, text: g.text });
      else run.refused.push({ slotId: g.slot.id, reason: res.createPost.message ?? "Buffer refused this draft." });
    } catch (e) {
      const w = waitRefusal(e);
      if (w) { stopAt(run, w, group.slice(i), gi); return; }
      if (outcomeUnknown(e)) {
        run.requests++;
        settleUnknown(run, await readBack(run.token, [g], run.q), [g]);
      } else run.refused.push({ slotId: g.slot.id, reason: e instanceof Error ? e.message : "Buffer could not be reached." });
    }
  }
}

/**
 * Saves drafts into slots that are still open right now. `open` must come from a fresh read of the queue: a slot
 * filled since the AI listed it is refused rather than double-booked.
 */
export async function saveDrafts(
  token: string,
  input: { title: string; drafts: DraftInput[]; open: OpenSlot[] },
  q: Query = bufferQuery,
): Promise<SaveResult> {
  const { refused, ready } = sortDrafts(input.drafts, input.open);
  const limits = await slotsAtLimit(token, ready, q);
  if (limits.wait) {
    const reason = notSentReason(limits.wait);
    return { saved: [], refused: [...refused, ...ready.map((r) => ({ slotId: r.slot.id, reason }))], requests: limits.requests, waitUntil: limits.wait.retryAt };
  }
  const allowed = ready.filter((r) => {
    const st = limits.atLimit.get(r.slot.id);
    if (!st) return true;
    const used = st.scheduled + st.sent;
    refused.push({ slotId: r.slot.id, reason: `${r.slot.channel} is at its daily posting limit in Buffer for that time (${used}${st.limit ? ` of ${st.limit}` : ""} posts). Pick another slot.` });
    return false;
  });
  const run: Run = { token, title: input.title, q, saved: [], refused, requests: limits.requests, useContentItems: true, wait: null, groups: groupByChannel(allowed) };
  for (const [gi, group] of run.groups.entries()) {
    if (run.wait) break;
    const asItem = run.useContentItems ? await saveAsItem(run, group, gi) : "posts";
    if (asItem === "stop") break;
    if (asItem === "posts") await saveEachPost(run, group, gi);
  }
  return { saved: run.saved, refused: run.refused, requests: run.requests, ...(run.wait ? { waitUntil: run.wait.retryAt } : {}) };
}
