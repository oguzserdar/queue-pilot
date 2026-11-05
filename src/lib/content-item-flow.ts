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
import { evidenceProblem, type EvidenceInput } from "./source-evidence";
import { recordEvidence, sourceById } from "./source-store";
import { limit } from "./rate-limit";
import { postgresWrittenStore, wroteIds } from "./written-store";
import { postgresPromotionAttempts, promotionFingerprint } from "./promotion-attempts";
import { patchAfterWrite, withoutPosts, withPosts } from "./buffer/snapshot";
import { postgresSnapshotStore } from "./buffer/snapshot-store";
import type { Channel, Post, PostStatus } from "./buffer/queries";

const STATUSES = new Set<string>(["draft", "error", "needs_approval", "scheduled", "sending", "sent"]);

/** What the flow needs from the person's Buffer connection. */
export type ItemBuffer = { token: string; organizationIds: string[]; channels: Channel[]; posts: { id: string; channelId: string }[] };

/** One answer: the text an assistant reads, whether it is a failure, and fields a screen can use. */
/**
 * Whether an error means Buffer answered and refused (GraphQL errors with no data, or a 4xx other than the rate limit),
 * as opposed to an answer that never arrived or a server error, where the write may have happened.
 */
export function refusedByBuffer(e: unknown): boolean {
  if (!(e instanceof BufferApiError)) return false;
  if (e.status === 200) return e.message !== "Buffer API returned no data";
  return e.status >= 400 && e.status < 500 && e.status !== 429;
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

/**
 * The flow for one person.
 *
 * @param userId - The person
 * @returns Item reads with ownership checks, and save/promote
 */
export function contentItemFlow(userId: string) {
  const result = (value: unknown, isError = false, extra: Partial<FlowAnswer> = {}): FlowAnswer => ({ text: typeof value === "string" ? value : JSON.stringify(value, null, 2), isError, ...extra });
  const pickOrg = (b: ItemBuffer, organizationId?: string): string | null => {
    const org = organizationId ?? (b.organizationIds.length === 1 ? b.organizationIds[0] : undefined);
    return org && b.organizationIds.includes(org) ? org : null;
  };
  const chooseOrg = (b: ItemBuffer) => result(`Choose one organizationId: ${b.organizationIds.join(", ") || "none found"}.`, true);
  /**
   * Reads an item and proves it belongs to the person before anything touches it. Only Buffer's own "not found" means
   * absent; any other failure (timeout, outage, expired sign-in) is thrown, so a failed read is never taken for a
   * deleted or missing item.
   */
  const ownItem = async (b: ItemBuffer, id: string): Promise<ContentItemView | null> => {
    try {
      const item = await getContentItem(b.token, id);
      return b.organizationIds.includes(item.organizationId) ? item : null;
    } catch (e) {
      if (e instanceof BufferApiError && e.status !== 401 && (e.code === "NOT_FOUND" || /not found|does not exist|no content item/i.test(e.message))) return null;
      throw e;
    }
  };
  /** ownItem for recovery paths: a failed read becomes "unknown" instead of failing the whole answer. */
  const readBack = (b: ItemBuffer, id: string): Promise<ContentItemView | null | "unknown"> =>
    ownItem(b, id).catch((e) => { if (e instanceof BufferApiError && e.status === 401) throw e; return "unknown" as const; });
  const attempts = postgresPromotionAttempts();
  const media = result("This draft has images or video attached. Queue Pilot cannot keep media through this change yet, so it leaves the draft alone: change it in Buffer.", true);
  const notFound = result("No content item with that id in the person's Buffer.", true);
  const same = (a: string, b2: string) => a.replace(/\s+/g, " ").trim() === b2.replace(/\s+/g, " ").trim();
  /**
   * Records the item's posts that match these versions (same account, same text) as drafts Queue Pilot wrote, with
   * their evidence first, exactly like save_drafts: no ownership record without its evidence. Verdicts from this call's
   * checks are kept; a repair after an unclear result records none, so approving needs a fresh check.
   */
  const reconcile = async (it: ContentItemView, versions: { channelId: string; text: string; snapshotId?: string; evidence?: EvidenceInput[] }[], networks: string[], checks: Extract<TextCheck, { kind: "checked" }>[] | null) => {
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
  };
  /**
   * Puts the posts Buffer confirmed for an item into the saved copy, so the next week or drafts read shows them without
   * a refresh (the copy is otherwise reused for up to 30 seconds after any read). A failed patch leaves the copy as it was.
   */
  const showInCopy = async (view: ContentItemView) => {
    if (view.body.kind !== "posts" || !view.body.posts.length) return;
    const made: Post[] = view.body.posts.map((p) => ({ id: p.id, channelId: p.channelId, status: STATUSES.has(p.status) ? (p.status as PostStatus) : "draft", text: p.text, dueAt: p.dueAt, sentAt: null, externalLink: null, error: null }));
    await patchCopy((s) => withPosts(s, made));
  };
  /** Takes posts Buffer confirmed deleting out of the saved copy. */
  const dropFromCopy = async (ids: string[]) => { if (ids.length) await patchCopy((s) => withoutPosts(s, ids)); };
  const patchCopy = async (change: Parameters<typeof patchAfterWrite>[2]) => {
    try { await patchAfterWrite(userId, postgresSnapshotStore(), change); }
    catch (e) { console.warn(JSON.stringify({ event: "qp-snapshot-patch-after-item-write-failed", message: e instanceof Error ? e.message : String(e) })); }
  };
  const counts = (d: { created: number; recorded: number }) => `Buffer has ${d.created} draft${d.created === 1 ? "" : "s"} from this promotion; Queue Pilot recorded ${d.recorded} as its own.`;
  const nameOf = (b: ItemBuffer) => (id: string) => b.channels.find((c) => c.id === id)?.name ?? id;

  /** Saves a new channel-less draft, or replaces the text of one the person reviewed. */
  async function save(b: ItemBuffer, { text, title, targetDate, contentItemId, expectedText, requestId, organizationId }: { text: string; title?: string; targetDate?: string; contentItemId?: string; expectedText?: string; requestId?: string; organizationId?: string }): Promise<FlowAnswer> {
    if (contentItemId) {
      if (expectedText === undefined) return result("Pass expectedText: the draft text as last read, so a newer edit in Buffer is not overwritten.", true);
      const item = await ownItem(b, contentItemId);
      if (!item) return notFound;
      if (item.body.kind !== "draft") return result("That item already has posts, so its draft can no longer change. Edit each post with update_draft.", true);
      if (item.body.mediaCount) return media;
      if (same(item.body.text, text)) return result(`Already saved with that text.\n${describe(item, nameOf(b))}`);
      if (!same(item.body.text, expectedText)) return result(`Not changed: the draft changed in Buffer since it was read. Current text:\n<draft_text>${item.body.text}</draft_text>`, true);
      const r = await updateChannelLessDraft(b.token, item.id, text);
      return r.ok ? result(`Draft text replaced.\n${describe(r.value, nameOf(b))}`, false, { item: r.value }) : result(`Not changed: ${failure(r)}`, true);
    }
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
      if (refusedByBuffer(e)) return result(`Not saved: Buffer refused it (${(e as Error).message}). If Buffer says the requestId is already used or invalid, pass a new random UUID.`, true);
      return result(`Buffer did not answer clearly, so the draft may or may not be saved. Retry with requestId "${correlationId}": Buffer then returns the same draft instead of making a second.`, true);
    }
  }

  /** Turns a channel-less draft into one checked Buffer draft per account. */
  async function promote(b: ItemBuffer, { contentItemId, expectedDraftText, versions }: { contentItemId: string; expectedDraftText: string; versions: Version[] }): Promise<FlowAnswer> {
    const item = await ownItem(b, contentItemId);
    if (!item) return notFound;
    const ids = versions.map((v) => v.channelId);
    if (new Set(ids).size !== ids.length) return result("One version per account: an account appears twice.", true);
    const channels = ids.map((id) => b.channels.find((c) => c.id === id));
    const foreign = ids.filter((_, i) => !channels[i] || channels[i]!.organizationId !== item.organizationId);
    if (foreign.length) return result(`Not the person's accounts in this item's organization: ${foreign.join(", ")}. Read list_channels.`, true);
    // Every quoted source must be the person's own before anything is checked or written.
    const evidenceNotes: string[] = [];
    for (const [i, v] of versions.entries()) {
      if (!v.snapshotId) { if (v.evidence?.length) return result(`${channels[i]!.name}: evidence needs the snapshotId of the source it quotes.`, true); continue; }
      const snapshot = await sourceById(userId, v.snapshotId);
      if (!snapshot) return result(`${channels[i]!.name}: that source is not in this account.`, true);
      if (!v.evidence?.length) evidenceNotes.push(`${channels[i]!.name}: no source quote supplied; check evidence before approving.`);
      for (const e of v.evidence ?? []) { const problem = evidenceProblem(v.text, snapshot.text, e, snapshot.metadata); if (problem) evidenceNotes.push(`${channels[i]!.name}: ${problem}`); }
    }
    const fingerprint = promotionFingerprint(versions);
    if (item.body.kind !== "draft") {
      // A retry after an unclear promote. Only posts from Queue Pilot's own recorded attempt with these exact versions
      // are adopted; posts made any other way stay the person's (or another app's), untouched.
      const attempt = await attempts.get(userId, item.id);
      if (!attempt || attempt.fingerprint !== fingerprint) return result("That item already has posts that this promotion did not create, so Queue Pilot leaves them alone. Read get_content_item.", true);
      if (attempt.recordedAt) return result(`Already turned into drafts and recorded.\n${describe(item, nameOf(b))}`);
      const done = await reconcile(item, versions, channels.map((c) => c!.service), null);
      if (done.missing.length) return result(`That item has posts, but not for every version given (${done.missing.join(", ")}). Read get_content_item.`, true);
      if (done.complete) await attempts.markRecorded(userId, item.id, attempt.token);
      await showInCopy(item);
      return result([`Already turned into drafts. ${counts(done)} They need a fresh check before approving.`, ...done.notes, ...(done.complete ? [] : ["Call again with the same versions to finish recording."]), describe(item, nameOf(b))].join("\n"), !done.complete);
    }
    if (item.body.mediaCount) return media;
    if (!same(item.body.text, expectedDraftText)) return result(`Not promoted: the draft changed in Buffer since it was reviewed. Current text:\n<draft_text>${item.body.text}</draft_text>`, true);
    const l = await limit("ai", userId);
    if (!l.ok) return result("Too many AI requests just now. Try again in a minute.", true);
    // Each account's own text limit from Buffer; the built-in table only where Buffer states none.
    const limits = await textLimits(b.token, [item.organizationId]);
    const checks: Extract<TextCheck, { kind: "checked" }>[] = [];
    for (const [i, v] of versions.entries()) {
      const c = await checkText(userId, v.text, channels[i]!.service, v.channelId, limits.get(v.channelId));
      if (c.kind !== "checked") return result(c.message, true);
      checks.push(c);
    }
    const refusedBy = checks.flatMap((c, i) => c.status === "refused" ? [{ channelId: versions[i].channelId, name: channels[i]!.name, reason: c.reason ?? c.verdicts.filter((v) => v.level === "block" && v.verdict === "fail").map((v) => `${v.rule}${v.reason ? ` (${v.reason})` : ""}`).join("; ") }] : []);
    const refusedAt = refusedBy.map((r) => `- ${r.name}: ${r.reason}`);
    if (refusedAt.length) return result({ status: "refused", created: false, message: "Nothing was created. Fix these versions and call again:", refused: refusedAt }, false, { refused: refusedBy.map(({ channelId, reason }) => ({ channelId, reason })) });
    // The checks took time: re-read so a newer Buffer edit is refused, not discarded. Buffer offers no compare-and-set,
    // so an edit landing between this read and the promote itself cannot be detected.
    const fresh = await readBack(b, item.id);
    if (fresh === "unknown") return result("Not promoted: the draft could not be read again after the checks. Try again in a minute.", true);
    if (fresh && fresh.body.kind === "draft" && fresh.body.mediaCount) return media;
    if (!fresh || fresh.body.kind !== "draft" || !same(fresh.body.text, expectedDraftText)) return result("Not promoted: the draft changed in Buffer while the versions were checked. Read get_content_item and review again.", true);
    // Claimed before the request, so a recovery can prove this app asked for these posts and no overlapping call with
    // different versions can take the item over.
    const token = await attempts.claim(userId, item.id, fingerprint);
    if (!token) return result("Another promotion of this item with different versions is still in progress. Read get_content_item in a minute.", true);
    let outcome: ItemWriteResult<ContentItemView> | { thrown: string };
    try {
      outcome = await promoteToDraftPosts(b.token, item.id, versions);
    } catch (e) {
      if (e instanceof BufferApiError && e.status === 401) throw e;
      outcome = { thrown: e instanceof Error ? e.message : String(e) };
    }
    if ("ok" in outcome && outcome.ok) {
      const done = await reconcile(outcome.value, versions, channels.map((c) => c!.service), checks);
      if (done.complete) await attempts.markRecorded(userId, item.id, token);
      await showInCopy(outcome.value);
      const flagged = checks.flatMap((c, i) => c.status === "flagged" || c.status === "uncertain" ? [`${channels[i]!.name}: ${c.status}`] : []);
      return result([`${counts(done)} None are scheduled.${flagged.length ? ` Flagged: ${flagged.join("; ")}.` : ""}`, ...evidenceNotes, ...done.notes, ...(done.complete ? [] : ["Call again with the same versions to finish recording."]), describe(outcome.value, nameOf(b))].join("\n"), !done.complete, { item: outcome.value, created: done.created, recorded: done.recorded });
    }
    // Buffer: a failure can arrive after the promotion took effect. Read the real state and repair QP's records.
    const why = "thrown" in outcome ? `Buffer did not answer clearly (${outcome.thrown}).` : `Buffer reported a problem: ${failure(outcome)}`;
    const now = await readBack(b, item.id);
    if (now === "unknown") return result(`${why}\nThe item could not be read back, so whether the drafts exist is unknown. Read get_content_item, then call again with the same versions: Queue Pilot records its own drafts instead of promoting twice.`, true);
    if (now?.body.kind === "posts") {
      const done = await reconcile(now, versions, channels.map((c) => c!.service), checks);
      if (done.complete) await attempts.markRecorded(userId, item.id, token);
      await showInCopy(now);
      return result([`${why}\nThe drafts were created anyway. ${counts(done)} None are scheduled.`, ...done.notes, ...(done.complete ? [] : ["Call again with the same versions to finish recording."]), describe(now, nameOf(b))].join("\n"), !done.complete);
    }
    return result(`${why}\n${now ? "The item is still a channel-less draft; nothing was created." : "The item could not be read back. Read get_content_item before trying again."}`, true);
  }

  return { pickOrg, chooseOrg, ownItem, readBack, notFound, nameOf, save, promote, dropFromCopy };
}
