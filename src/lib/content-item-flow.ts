/**
 * @fileoverview "Write once, pick accounts later" as one flow shared by the connector tools and Queue Pilot's own
 * screen: save or replace a channel-less draft in Buffer, then turn it into one checked Buffer DRAFT per account with
 * its source evidence. No path can check or record more loosely than another, because both call this module.
 *
 * Boundaries: every item is read first and must belong to one of the person's own Buffer organizations; accounts and
 * sources must be the person's own. Promotion always creates drafts (saveToDraft: true). A promotion is claimed in
 * qp_promotion_attempt before the request, so a recovery after an unclear answer adopts only posts this app asked for.
 */
import {
  createChannelLessDraft, getContentItem, promoteToDraftPosts, updateChannelLessDraft, type ContentItemView, type ItemWriteResult,
} from "./buffer/content-items";
import { checkText, type TextCheck } from "./check-text";
import { textLimits } from "./buffer/workspace";
import { BufferApiError } from "./buffer/client";
import { evidenceProblem, NO_SOURCE_REASON, type EvidenceInput } from "./source-evidence";
import { recordEvidence, sourceById } from "./source-store";
import { limit } from "./rate-limit";
import { postgresWrittenStore, wroteIds } from "./written-store";
import { postgresPromotionAttempts, promotionFingerprint } from "./promotion-attempts";
import { patchAfterWrite, withoutPosts, withPosts } from "./buffer/snapshot";
import { postgresSnapshotStore } from "./buffer/snapshot-store";
import type { Channel, Post, PostStatus } from "./buffer/queries";

const STATUSES = ["draft", "error", "needs_approval", "scheduled", "sending", "sent"] as const satisfies readonly PostStatus[];
const isPostStatus = (s: string): s is PostStatus => STATUSES.some((x) => x === s);

/** What the flow needs from the person's Buffer connection. */
export type ItemBuffer = { token: string; organizationIds: string[]; channels: Channel[]; posts: { id: string; channelId: string }[] };

/** One answer: the text an assistant reads, whether it is a failure, and fields a screen can use. */
/** GraphQL error codes that mean the request was rejected before anything ran: bad input, validation, permission. */
const REFUSAL_CODES = new Set(["BAD_USER_INPUT", "GRAPHQL_VALIDATION_FAILED", "GRAPHQL_PARSE_FAILED", "FORBIDDEN", "UNAUTHENTICATED", "INSUFFICIENT_SCOPE"]);
/**
 * Uncoded error text that names one of this save's own fields as rejected ("Invalid correlationId", "text is
 * required"). Generic text such as "Invalid response from upstream" does not match, so it stays an unclear answer.
 */
const FIELDS = "correlationId|organizationId|text|title|targetDate|draft";
const REFUSAL_TEXT = new RegExp(`\\binvalid (${FIELDS})\\b|\\b(${FIELDS}) (is required|must be|is invalid)\\b`, "i");

/**
 * Whether an error certainly means Buffer rejected the request before writing anything: a known input, validation
 * or permission refusal (by GraphQL code or error text), or HTTP 400, 403, 404 or 422. Anything else, including
 * internal GraphQL errors, timeouts (408), rate limits and lost answers, may have followed a write, so it is not a
 * refusal: the caller retries with the same requestId, which Buffer answers with the same draft if one was made.
 */
export function refusedByBuffer(e: unknown): boolean {
  if (!(e instanceof BufferApiError)) return false;
  if (e.status === 200) return (e.code !== undefined && REFUSAL_CODES.has(e.code)) || (e.code === undefined && REFUSAL_TEXT.test(e.message));
  return [400, 403, 404, 422].includes(e.status);
}

export type FlowAnswer = { text: string; isError: boolean; item?: ContentItemView; refused?: { channelId: string; reason: string }[]; created?: number; recorded?: number };

/** One version of the draft for one account. */
export type Version = { channelId: string; text: string; dueAt?: string; snapshotId?: string; evidence?: EvidenceInput[] };

/** One content item as the assistant reads it. */
export function describe(item: ContentItemView, channelName: (id: string) => string): string {
  const head = `${item.title ? `"${item.title}"` : "Untitled"} · content item id ${item.id}${item.targetDate ? ` · planned for ${item.targetDate.slice(0, 10)}` : ""}${item.tags.length ? ` · tags ${item.tags.map((t) => t.name).join(", ")}` : ""}`;
  if (item.body.kind === "draft") return `${head}\n  Channel-less draft${item.body.aiAssisted ? " (written with AI)" : ""}:\n  <draft_text>${item.body.text}</draft_text>`;
  return `${head}\n  Posts: ${item.body.posts.map((p) => `${channelName(p.channelId)} ${p.status} (post id ${p.id})`).join("; ") || "none"}`;
}

/** Buffer's refusal with every reason it gave. */
export const failure = (r: Extract<ItemWriteResult<unknown>, { ok: false }>) => [r.message, ...r.errors.map((e) => `- ${e.channelId ? `${e.channelId}: ` : ""}${e.message}`)].join("\n");

type Checked = Extract<TextCheck, { kind: "checked" }>;
type Draftable = { channelId: string; text: string; snapshotId?: string; evidence?: EvidenceInput[] };

const result = (value: unknown, isError = false, extra: Partial<FlowAnswer> = {}): FlowAnswer => ({ text: typeof value === "string" ? value : JSON.stringify(value, null, 2), isError, ...extra });
const pickOrg = (b: ItemBuffer, organizationId?: string): string | null => {
  const org = organizationId ?? (b.organizationIds.length === 1 ? b.organizationIds[0] : undefined);
  return org && b.organizationIds.includes(org) ? org : null;
};
const chooseOrg = (b: ItemBuffer) => result(`Choose one organizationId: ${b.organizationIds.join(", ") || "none found"}.`, true);
const mediaAnswer = () => result("This draft has images or video attached. Queue Pilot cannot keep media through this change yet, so it leaves the draft alone: change it in Buffer.", true);
const notFoundAnswer = () => result("No content item with that id in the person's Buffer.", true);
const same = (a: string, b2: string) => a.replace(/\s+/g, " ").trim() === b2.replace(/\s+/g, " ").trim();
const counts = (d: { created: number; recorded: number }) => `Buffer has ${d.created} draft${d.created === 1 ? "" : "s"} from this promotion; Queue Pilot recorded ${d.recorded} as its own.`;
const nameOf = (b: ItemBuffer) => (id: string) => b.channels.find((c) => c.id === id)?.name ?? id;
const AGAIN = "Call again with the same versions to finish recording.";

/**
 * Reads an item and proves it belongs to the person before anything touches it. Only Buffer's own "not found" means
 * absent; any other failure (timeout, outage, expired sign-in) is thrown, so a failed read is never taken for a
 * deleted or missing item.
 */
async function ownItem(b: ItemBuffer, id: string): Promise<ContentItemView | null> {
  try {
    const item = await getContentItem(b.token, id);
    return b.organizationIds.includes(item.organizationId) ? item : null;
  } catch (e) {
    if (e instanceof BufferApiError && e.status !== 401 && (e.code === "NOT_FOUND" || /not found|does not exist|no content item/i.test(e.message))) return null;
    throw e;
  }
}

/** ownItem for recovery paths: a failed read becomes "unknown" instead of failing the whole answer. */
const readBack = (b: ItemBuffer, id: string): Promise<ContentItemView | null | "unknown"> =>
  ownItem(b, id).catch((e) => { if (e instanceof BufferApiError && e.status === 401) throw e; return "unknown" as const; });

/**
 * Records the item's posts that match these versions (same account, same text) as drafts Queue Pilot wrote, with
 * their evidence first, exactly like save_drafts: no ownership record without its evidence. Verdicts from this call's
 * checks are kept; a repair after an unclear result records none, so approving needs a fresh check.
 */
async function reconcile(userId: string, it: ContentItemView, versions: Draftable[], networks: string[], checks: Checked[] | null) {
  const posts = it.body.kind === "posts" ? it.body.posts : [];
  const notes: string[] = [];
  const missing: string[] = [];
  let recorded = 0;
  const already = await wroteIds(userId, ...posts.map((p) => p.id));
  for (const [i, v] of versions.entries()) {
    const post = posts.find((p) => p.channelId === v.channelId && same(p.text, v.text));
    if (!post) { missing.push(v.channelId); continue; }
    if (already.has(post.id)) { recorded++; continue; }
    if (post.status !== "draft") { notes.push(`${v.channelId}: post ${post.id} is ${post.status}, not a draft; not recorded.`); continue; }
    if (v.snapshotId) {
      const evidence = v.evidence?.length ? v.evidence : [{ claim: v.text.slice(0, 500), quote: "[No source quote supplied]" }];
      const ok = await recordEvidence(userId, post.id, post.text, v.snapshotId, evidence).then(() => true, () => false);
      if (!ok) { notes.push(`${v.channelId}: draft ${post.id} saved, but its evidence could not be recorded. Do not promote again.`); continue; }
    }
    await postgresWrittenStore().record(userId, [{ postId: post.id, network: networks[i], text: post.text, verdicts: checks?.[i]?.verdicts ?? null, playbookRevision: checks?.[i]?.playbookRevision ?? null }]);
    recorded++;
  }
  // Complete only when every version's draft is recorded; evidence failures and non-drafts keep recovery pending.
  return { created: versions.length - missing.length, recorded, missing, notes, complete: recorded === versions.length };
}

async function patchCopy(userId: string, change: Parameters<typeof patchAfterWrite>[2]) {
  try { await patchAfterWrite(userId, postgresSnapshotStore(), change); }
  catch (e) { console.warn(JSON.stringify({ event: "qp-snapshot-patch-after-item-write-failed", message: e instanceof Error ? e.message : String(e) })); }
}

/**
 * Puts the posts Buffer confirmed for an item into the saved copy, so the next week or drafts read shows them without
 * a refresh (the copy is otherwise reused for up to 30 seconds after any read). A failed patch leaves the copy as it was.
 */
async function showInCopy(userId: string, view: ContentItemView) {
  if (view.body.kind !== "posts" || !view.body.posts.length) return;
  const made: Post[] = view.body.posts.map((p) => ({ id: p.id, channelId: p.channelId, status: isPostStatus(p.status) ? p.status : "draft", text: p.text, dueAt: p.dueAt, sentAt: null, externalLink: null, error: null }));
  await patchCopy(userId, (s) => withPosts(s, made));
}

/** Saves a new channel-less draft, or replaces the text of one the person reviewed. */
async function save(b: ItemBuffer, { text, title, targetDate, contentItemId, expectedText, requestId, organizationId }: { text: string; title?: string; targetDate?: string; contentItemId?: string; expectedText?: string; requestId?: string; organizationId?: string }): Promise<FlowAnswer> {
  if (contentItemId) return replaceDraft(b, contentItemId, text, expectedText);
  return createDraft(b, { text, title, targetDate, requestId, organizationId });
}

/** Replaces the text of a channel-less draft the person reviewed, unless it changed in Buffer since. */
async function replaceDraft(b: ItemBuffer, contentItemId: string, text: string, expectedText: string | undefined): Promise<FlowAnswer> {
  if (expectedText === undefined) return result("Pass expectedText: the draft text as last read, so a newer edit in Buffer is not overwritten.", true);
  const item = await ownItem(b, contentItemId);
  if (!item) return notFoundAnswer();
  if (item.body.kind !== "draft") return result("That item already has posts, so its draft can no longer change. Edit each post with update_draft.", true);
  if (item.body.mediaCount) return mediaAnswer();
  if (same(item.body.text, text)) return result(`Already saved with that text.\n${describe(item, nameOf(b))}`, false, { item });
  if (!same(item.body.text, expectedText)) return result(`Not changed: the draft changed in Buffer since it was read. Current text:\n<draft_text>${item.body.text}</draft_text>`, true);
  const r = await updateChannelLessDraft(b.token, item.id, text);
  return r.ok ? result(`Draft text replaced.\n${describe(r.value, nameOf(b))}`, false, { item: r.value }) : result(`Not changed: ${failure(r)}`, true);
}

/** Saves a new channel-less draft under a request id the caller keeps, so a retry cannot make a second one. */
async function createDraft(b: ItemBuffer, { text, title, targetDate, requestId, organizationId }: { text: string; title?: string; targetDate?: string; requestId?: string; organizationId?: string }): Promise<FlowAnswer> {
  const org = pickOrg(b, organizationId);
  if (!org) return chooseOrg(b);
  // The id must exist before the request: a retry after a lost answer is only safe if it reuses the same id.
  if (!requestId) return result("Pass requestId: a fresh UUID you keep, so a retry after an unclear answer cannot create a second draft.", true);
  const correlationId = requestId;
  try {
    const r = await createChannelLessDraft(b.token, org, { text, title, targetDate, correlationId });
    return r.ok ? result(`Draft saved in Buffer without an account. Nothing was scheduled.\n${describe(r.value, nameOf(b))}`, false, { item: r.value }) : result(`Not saved: ${failure(r)}`, true);
  } catch (e) {
    if (e instanceof BufferApiError && e.status === 401) throw e;
    console.error(JSON.stringify({ event: "qp-channel-less-save-failed", status: e instanceof BufferApiError ? e.status : null, code: e instanceof BufferApiError ? e.code ?? null : null, message: e instanceof Error ? e.message : String(e) }));
    // Buffer answered with an error (GraphQL errors, or a 4xx other than the rate limit): a refusal, not an unknown.
    if (refusedByBuffer(e) && e instanceof Error) return result(`Not saved: Buffer refused it (${e.message}). If Buffer says the requestId is already used or invalid, pass a new random UUID.`, true);
    return result(`Buffer did not answer clearly, so the draft may or may not be saved. Retry with requestId "${correlationId}": Buffer then returns the same draft instead of making a second.`, true);
  }
}

/** Either the value a step produced, or the answer that ends the promotion there. */
type Step<T> = { ok: T } | { answer: FlowAnswer };

/** The person's accounts the versions name, all in the item's organization, one version each. */
function accountsFor(b: ItemBuffer, item: ContentItemView, versions: Version[]): Step<Channel[]> {
  const ids = versions.map((v) => v.channelId);
  if (new Set(ids).size !== ids.length) return { answer: result("One version per account: an account appears twice.", true) };
  const found = ids.map((id) => b.channels.find((c) => c.id === id));
  const foreign = ids.filter((_, i) => found[i]?.organizationId !== item.organizationId);
  const channels = found.filter((c): c is Channel => c !== undefined);
  if (foreign.length || channels.length !== ids.length) return { answer: result(`Not the person's accounts in this item's organization: ${foreign.join(", ")}. Read list_channels.`, true) };
  return { ok: channels };
}

/** Every quoted source must be the person's own before anything is checked or written; returns notes on the rest. */
async function evidenceNotesFor(userId: string, versions: Version[], channels: Channel[], byHand: boolean | undefined): Promise<Step<string[]>> {
  const notes: string[] = [];
  for (const [i, v] of versions.entries()) {
    const name = channels[i].name;
    if (!v.snapshotId) {
      if (v.evidence?.length) return { answer: result(`${name}: evidence needs the snapshotId of the source it quotes.`, true) };
      if (!byHand) notes.push(`${name}: ${NO_SOURCE_REASON}`);
      continue;
    }
    const snapshot = await sourceById(userId, v.snapshotId);
    if (!snapshot) return { answer: result(`${name}: that source is not in this account.`, true) };
    if (!v.evidence?.length) notes.push(`${name}: no source quote supplied; check evidence before approving.`);
    for (const e of v.evidence ?? []) { const problem = evidenceProblem(v.text, snapshot.text, e, snapshot.metadata); if (problem) notes.push(`${name}: ${problem}`); }
  }
  return { ok: notes };
}

/** The answer after recording an item's posts: what was made and recorded, and what is left to do. */
function recordedAnswer(b: ItemBuffer, view: ContentItemView, lead: string, done: Awaited<ReturnType<typeof reconcile>>, extraNotes: string[] = []): FlowAnswer {
  return result([lead, ...extraNotes, ...done.notes, ...(done.complete ? [] : [AGAIN]), describe(view, nameOf(b))].join("\n"), !done.complete, { item: view, created: done.created, recorded: done.recorded });
}

/**
 * A retry after an unclear promote. Only posts from Queue Pilot's own recorded attempt with these exact versions are
 * adopted; posts made any other way stay the person's (or another app's), untouched.
 */
async function adoptPromoted(userId: string, b: ItemBuffer, item: ContentItemView, versions: Version[], channels: Channel[], fingerprint: string): Promise<FlowAnswer> {
  const attempts = postgresPromotionAttempts();
  const attempt = await attempts.get(userId, item.id);
  if (!attempt || attempt.fingerprint !== fingerprint) return result("That item already has posts that this promotion did not create, so Queue Pilot leaves them alone. Read get_content_item.", true);
  if (attempt.recordedAt) return result(`Already turned into drafts and recorded.\n${describe(item, nameOf(b))}`, false, { item });
  const done = await reconcile(userId, item, versions, channels.map((c) => c.service), null);
  if (done.missing.length) return result(`That item has posts, but not for every version given (${done.missing.join(", ")}). Read get_content_item.`, true);
  if (done.complete) await attempts.markRecorded(userId, item.id, attempt.token);
  await showInCopy(userId, item);
  return recordedAnswer(b, item, `Already turned into drafts. ${counts(done)} They need a fresh check before approving.`, done);
}

/** Checks every version against the playbook and platform; any refusal ends the promotion before anything is made. */
async function checkVersions(userId: string, b: ItemBuffer, item: ContentItemView, versions: Version[], channels: Channel[]): Promise<Step<Checked[]>> {
  const l = await limit("ai", userId);
  if (!l.ok) return { answer: result("Too many AI requests just now. Try again in a minute.", true) };
  // Each account's own text limit from Buffer; the built-in table only where Buffer states none.
  const limits = await textLimits(b.token, [item.organizationId]);
  const checks: Checked[] = [];
  for (const [i, v] of versions.entries()) {
    const c = await checkText(userId, v.text, channels[i].service, v.channelId, limits.get(v.channelId));
    if (c.kind !== "checked") return { answer: result(c.message, true) };
    checks.push(c);
  }
  const refusedBy = checks.flatMap((c, i) => c.status === "refused" ? [{ channelId: versions[i].channelId, name: channels[i].name, reason: c.reason ?? c.verdicts.filter((v) => v.level === "block" && v.verdict === "fail").map((v) => `${v.rule}${v.reason ? ` (${v.reason})` : ""}`).join("; ") }] : []);
  const refusedAt = refusedBy.map((r) => `- ${r.name}: ${r.reason}`);
  if (refusedAt.length) return { answer: result({ status: "refused", created: false, message: "Nothing was created. Fix these versions and call again:", refused: refusedAt }, false, { refused: refusedBy.map(({ channelId, reason }) => ({ channelId, reason })) }) };
  return { ok: checks };
}

/** What promoting an unchanged, checked draft needs. */
type Promotion = { userId: string; b: ItemBuffer; item: ContentItemView; versions: Version[]; channels: Channel[]; checks: Checked[]; evidenceNotes: string[]; fingerprint: string };

/** Claims the item, promotes it, and records the drafts; after an unclear answer, reads the real state and repairs. */
async function promoteChecked(p: Promotion): Promise<FlowAnswer> {
  const { userId, b, item, versions, channels, checks } = p;
  const attempts = postgresPromotionAttempts();
  // Claimed before the request, so a recovery can prove this app asked for these posts and no overlapping call with
  // different versions can take the item over.
  const token = await attempts.claim(userId, item.id, p.fingerprint);
  if (!token) return result("Another promotion of this item with different versions is still in progress. Read get_content_item in a minute.", true);
  let outcome: ItemWriteResult<ContentItemView> | { thrown: string };
  try {
    outcome = await promoteToDraftPosts(b.token, item.id, versions);
  } catch (e) {
    if (e instanceof BufferApiError && e.status === 401) throw e;
    outcome = { thrown: e instanceof Error ? e.message : String(e) };
  }
  const networks = channels.map((c) => c.service);
  if ("ok" in outcome && outcome.ok) {
    const done = await reconcile(userId, outcome.value, versions, networks, checks);
    if (done.complete) await attempts.markRecorded(userId, item.id, token);
    await showInCopy(userId, outcome.value);
    const flagged = checks.flatMap((c, i) => c.status === "flagged" || c.status === "uncertain" ? [`${channels[i].name}: ${c.status}`] : []);
    return recordedAnswer(b, outcome.value, `${counts(done)} None are scheduled.${flagged.length ? ` Flagged: ${flagged.join("; ")}.` : ""}`, done, p.evidenceNotes);
  }
  // Buffer: a failure can arrive after the promotion took effect. Read the real state and repair QP's records.
  const why = "thrown" in outcome ? `Buffer did not answer clearly (${outcome.thrown}).` : `Buffer reported a problem: ${failure(outcome)}`;
  const now = await readBack(b, item.id);
  if (now === "unknown") return result(`${why}\nThe item could not be read back, so whether the drafts exist is unknown. Read get_content_item, then call again with the same versions: Queue Pilot records its own drafts instead of promoting twice.`, true);
  if (now?.body.kind === "posts") {
    const done = await reconcile(userId, now, versions, networks, checks);
    if (done.complete) await attempts.markRecorded(userId, item.id, token);
    await showInCopy(userId, now);
    return recordedAnswer(b, now, `${why}\nThe drafts were created anyway. ${counts(done)} None are scheduled.`, done);
  }
  return result(`${why}\n${now ? "The item is still a channel-less draft; nothing was created." : "The item could not be read back. Read get_content_item before trying again."}`, true);
}

/** Whether the draft still reads as reviewed after the checks; a newer Buffer edit is refused, not discarded. */
async function stillAsReviewed(b: ItemBuffer, item: ContentItemView, expectedDraftText: string): Promise<FlowAnswer | null> {
  // Buffer offers no compare-and-set, so an edit landing between this read and the promote itself cannot be detected.
  const fresh = await readBack(b, item.id);
  if (fresh === "unknown") return result("Not promoted: the draft could not be read again after the checks. Try again in a minute.", true);
  if (fresh && fresh.body.kind === "draft" && fresh.body.mediaCount) return mediaAnswer();
  if (!fresh || fresh.body.kind !== "draft" || !same(fresh.body.text, expectedDraftText)) return result("Not promoted: the draft changed in Buffer while the versions were checked. Read get_content_item and review again.", true);
  return null;
}

/**
 * Turns a channel-less draft into one checked Buffer draft per account. `byHand` is true when the person typed the
 * versions themselves in the app: a version with no source is then expected and is not remarked on.
 */
async function promote(userId: string, b: ItemBuffer, { contentItemId, expectedDraftText, versions, byHand }: { contentItemId: string; expectedDraftText: string; versions: Version[]; byHand?: boolean }): Promise<FlowAnswer> {
  const item = await ownItem(b, contentItemId);
  if (!item) return notFoundAnswer();
  const accounts = accountsFor(b, item, versions);
  if ("answer" in accounts) return accounts.answer;
  const channels = accounts.ok;
  const notes = await evidenceNotesFor(userId, versions, channels, byHand);
  if ("answer" in notes) return notes.answer;
  const fingerprint = promotionFingerprint(versions);
  if (item.body.kind !== "draft") return adoptPromoted(userId, b, item, versions, channels, fingerprint);
  if (item.body.mediaCount) return mediaAnswer();
  if (!same(item.body.text, expectedDraftText)) return result(`Not promoted: the draft changed in Buffer since it was reviewed. Current text:\n<draft_text>${item.body.text}</draft_text>`, true);
  const checked = await checkVersions(userId, b, item, versions, channels);
  if ("answer" in checked) return checked.answer;
  const changed = await stillAsReviewed(b, item, expectedDraftText);
  if (changed) return changed;
  return promoteChecked({ userId, b, item, versions, channels, checks: checked.ok, evidenceNotes: notes.ok, fingerprint });
}

/**
 * The flow for one person.
 *
 * @param userId - The person
 * @returns Item reads with ownership checks, and save/promote
 */
export function contentItemFlow(userId: string) {
  return {
    pickOrg,
    chooseOrg,
    ownItem,
    readBack,
    notFound: notFoundAnswer(),
    nameOf,
    save,
    promote: (b: ItemBuffer, args: Parameters<typeof promote>[2]) => promote(userId, b, args),
    /** Takes posts Buffer confirmed deleting out of the saved copy. */
    dropFromCopy: async (ids: string[]) => { if (ids.length) await patchCopy(userId, (s) => withoutPosts(s, ids)); },
  };
}
