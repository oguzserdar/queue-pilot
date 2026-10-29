/**
 * Saves the user's AI drafts into empty Buffer slots, as Buffer DRAFTS only (saveToDraft: true): nothing here can
 * schedule, publish or delete. Drafts go in through createContentItem, which writes one post per channel in a single
 * all-or-nothing call (developers.buffer.com/guides/content-items.md), so a week costs a few requests instead of one
 * per post. createContentItem is marked Experimental, so if Buffer rejects the mutation itself we fall back to one
 * createPost per draft with the same input.
 */
import { BufferApiError, bufferQuery } from "./buffer/client";
import { tooLong } from "./char-limits";
import type { OpenSlot } from "./open-slots";

type Query = typeof bufferQuery;

export type DraftInput = { slotId: string; text: string };
/** postId is Buffer's id for the draft, null when Buffer did not say; text is exactly what was saved, for reading edits back. */
export type SavedDraft = { slotId: string; channel: string; local: string; postId: string | null; network: string; text: string };
export type RefusedDraft = { slotId: string; reason: string };
export type SaveResult = { saved: SavedDraft[]; refused: RefusedDraft[]; requests: number };

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

const LIMITS = `query ($input: DailyPostingLimitsInput!) {
  dailyPostingLimits(input: $input) { channelId isAtLimit limit scheduled sent }
}`;

/** At most this many limit checks per save; each is one request (one intended time, one organization). */
export const MAX_LIMIT_CHECKS = 12;

type LimitStatus = { channelId: string; isAtLimit: boolean; limit: number | null; scheduled: number; sent: number };

/**
 * Asks Buffer whether adding a post at each slot's time would go over the network's daily limit
 * (developers.buffer.com/reference.md, dailyPostingLimits: one intended time per call, channels from one
 * organization; X uses the busiest rolling 24 hours). Returns the slots that would. A failed check blocks nothing:
 * Buffer still enforces the limit when the post is due.
 */
async function slotsAtLimit(token: string, items: { slot: OpenSlot }[], q: Query): Promise<{ atLimit: Map<string, LimitStatus>; requests: number }> {
  const groups = new Map<string, OpenSlot[]>();
  for (const { slot } of items) {
    const key = `${slot.organizationId}|${slot.at}`;
    groups.set(key, [...(groups.get(key) ?? []), slot]);
  }
  const atLimit = new Map<string, LimitStatus>();
  let requests = 0;
  for (const slots of [...groups.values()].slice(0, MAX_LIMIT_CHECKS)) {
    try {
      requests++;
      const res = await q<{ dailyPostingLimits: LimitStatus[] }>(token, LIMITS, { input: { channelIds: [...new Set(slots.map((s) => s.channelId))], date: slots[0].at } });
      for (const st of res.dailyPostingLimits) {
        if (!st.isAtLimit) continue;
        for (const s of slots) if (s.channelId === st.channelId) atLimit.set(s.id, st);
      }
    } catch {
      // The pre-check is advisory; see above.
    }
  }
  return { atLimit, requests };
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

/**
 * Saves drafts into slots that are still open right now. `open` must come from a fresh read of the queue: a slot
 * filled since the AI listed it is refused rather than double-booked.
 */
export async function saveDrafts(
  token: string,
  input: { title: string; drafts: DraftInput[]; open: OpenSlot[] },
  q: Query = bufferQuery,
): Promise<SaveResult> {
  const byId = new Map(input.open.map((s) => [s.id, s]));
  const refused: RefusedDraft[] = [];
  const ready: { slot: OpenSlot; text: string }[] = [];
  const used = new Set<string>();

  for (const d of input.drafts) {
    const slot = byId.get(d.slotId);
    const text = d.text.trim();
    if (!slot) refused.push({ slotId: d.slotId, reason: "That slot is no longer empty, or is not in the next two weeks." });
    else if (used.has(d.slotId)) refused.push({ slotId: d.slotId, reason: "Two drafts were given for the same slot; only the first was kept." });
    else if (!text) refused.push({ slotId: d.slotId, reason: "The draft is empty." });
    else if (!slot.organizationId) refused.push({ slotId: d.slotId, reason: "Refresh Queue Pilot once so it knows this channel's organization, then try again." });
    else {
      // Platform facts only (length, slot, organization, daily limit). The playbook is judged before this, by a model.
      const long = tooLong(slot.service, text);
      if (long) refused.push({ slotId: d.slotId, reason: `Too long for ${slot.channel}: ${long}.` });
      else {
        used.add(d.slotId);
        ready.push({ slot, text });
      }
    }
  }

  ready.sort((a, b) => a.slot.at.localeCompare(b.slot.at));
  const limits = await slotsAtLimit(token, ready, q);
  const allowed = ready.filter((r) => {
    const st = limits.atLimit.get(r.slot.id);
    if (!st) return true;
    const used = st.scheduled + st.sent;
    refused.push({ slotId: r.slot.id, reason: `${r.slot.channel} is at its daily posting limit in Buffer for that time (${used}${st.limit ? ` of ${st.limit}` : ""} posts). Pick another slot.` });
    return false;
  });
  const saved: SavedDraft[] = [];
  let requests = limits.requests;
  let useContentItems = true;
  const settleUnknown = (found: Map<string, string> | null, items: { slot: OpenSlot; text: string }[]) => {
    for (const g of items) {
      const postId = found?.get(g.slot.id);
      if (postId) saved.push({ slotId: g.slot.id, channel: g.slot.channel, local: g.slot.local, postId, network: g.slot.service, text: g.text });
      else refused.push({
        slotId: g.slot.id,
        reason: found ? "Buffer did not answer, and the draft is not in Buffer. Try again." : "Buffer did not answer and could not be checked. Check Buffer before trying again.",
      });
    }
  };

  for (const group of groupByChannel(allowed)) {
    if (useContentItems) {
      try {
        requests++;
        const res = await q<{ createContentItem: { __typename: string; message?: string; content?: { body?: { posts?: { id: string; channelId: string }[] } } } }>(token, CONTENT_ITEM, {
          input: { organizationId: group[0].slot.organizationId, title: input.title.slice(0, 200), posts: group.map((g) => postInput(g.slot, g.text)) },
        });
        if (res.createContentItem.__typename === "CreateContentItemSuccess") {
          // One post per channel in a group, so the channel id names each post Buffer created.
          const posts = res.createContentItem.content?.body?.posts ?? [];
          saved.push(...group.map((g) => ({ slotId: g.slot.id, channel: g.slot.channel, local: g.slot.local, postId: posts.find((p) => p.channelId === g.slot.channelId)?.id ?? null, network: g.slot.service, text: g.text })));
          continue;
        }
        // All or nothing: one bad post sinks the group. A single-post group already has its own reason; a bigger one
        // is retried post by post below, so each draft gets Buffer's answer for itself and the good ones are saved.
        if (group.length === 1) {
          refused.push({ slotId: group[0].slot.id, reason: res.createContentItem.message ?? "Buffer refused this draft." });
          continue;
        }
      } catch (e) {
        if (outcomeUnknown(e) && !contentItemUnavailable(e)) {
          requests++;
          settleUnknown(await readBack(token, group, q), group);
          continue;
        }
        if (!contentItemUnavailable(e)) {
          refused.push(...group.map((g) => ({ slotId: g.slot.id, reason: e instanceof Error ? e.message : "Buffer could not be reached." })));
          continue;
        }
        useContentItems = false;
      }
    }
    for (const g of group) {
      try {
        requests++;
        const res = await q<{ createPost: { __typename: string; message?: string; post?: { id: string } } }>(token, CREATE_POST, { input: postInput(g.slot, g.text) });
        if (res.createPost.__typename === "PostActionSuccess") saved.push({ slotId: g.slot.id, channel: g.slot.channel, local: g.slot.local, postId: res.createPost.post?.id ?? null, network: g.slot.service, text: g.text });
        else refused.push({ slotId: g.slot.id, reason: res.createPost.message ?? "Buffer refused this draft." });
      } catch (e) {
        if (outcomeUnknown(e)) {
          requests++;
          settleUnknown(await readBack(token, [g], q), [g]);
        } else refused.push({ slotId: g.slot.id, reason: e instanceof Error ? e.message : "Buffer could not be reached." });
      }
    }
  }

  return { saved, refused, requests };
}
