/**
 * @fileoverview Settles drafts the writer recorded but never marked: a run that stopped, or a Buffer save whose
 * answer never came back.
 *
 * The posting time in the slot id is the key. Buffer is read, never written, here:
 * - a draft with the same text sits on that time: it is ours, so the record is marked saved and it is recorded as
 *   written by Queue Pilot, without its playbook verdicts (the week asks for a fresh check);
 * - anything else: the record is marked failed with a reason. Nothing is saved again, so a late answer from Buffer
 *   can never meet a second copy.
 */
import type { Post } from "./buffer/queries";

export type OpenFillDraft = { runId: string; slotId: string; text: string; callStartedAt: Date | null; updatedAt: Date };
export type FillSettlement =
  | { runId: string; slotId: string; kind: "adopt"; postId: string }
  | { runId: string; slotId: string; kind: "fail"; reason: string };

/** A run gets this long to finish before its unmarked records are settled. Longer than the route may run. */
export const SETTLE_AFTER_MS = 6 * 60_000;

/**
 * Decides what to do with each unmarked record, from the queue as Buffer has it now.
 *
 * @param open - Records still "written"
 * @param posts - The person's current Buffer posts
 * @param now - The current time
 * @returns One decision per record old enough to settle; younger ones are left alone
 */
export function settleFillDrafts(open: OpenFillDraft[], posts: Post[], now: Date): FillSettlement[] {
  return open.filter((d) => now.getTime() - d.updatedAt.getTime() >= SETTLE_AFTER_MS).map((d) => {
    const at = d.slotId.lastIndexOf("@");
    const channelId = d.slotId.slice(0, at);
    const due = Date.parse(d.slotId.slice(at + 1));
    const there = posts.filter((p) => p.channelId === channelId && p.dueAt !== null && Date.parse(p.dueAt) === due && p.status !== "error");
    const ours = there.find((p) => p.status === "draft" && p.text.trim() === d.text.trim());
    if (ours) return { runId: d.runId, slotId: d.slotId, kind: "adopt", postId: ours.id };
    return {
      runId: d.runId, slotId: d.slotId, kind: "fail",
      reason: there.length ? "Something else was saved to this time before the draft could be."
        : d.callStartedAt ? "Buffer did not confirm the save, and the draft is not in your queue. The time is still empty."
        : "The run stopped before this draft was saved. The time is still empty.",
    };
  });
}

/**
 * Settles one person's unmarked records against their current queue. An adopted draft is recorded as written by
 * Queue Pilot before its record is marked, so it is never left as a draft the app does not know it wrote.
 *
 * @returns How many records were settled
 */
export async function recoverFillDrafts(userId: string, posts: Post[], networkOf: (channelId: string) => string, deps: {
  open(userId: string): Promise<OpenFillDraft[]>;
  settle(userId: string, decisions: FillSettlement[]): Promise<void>;
  record(userId: string, drafts: { postId: string; network: string; text: string; verdicts: null }[]): Promise<void>;
}, now = new Date()): Promise<number> {
  const open = await deps.open(userId);
  if (!open.length) return 0;
  const decisions = settleFillDrafts(open, posts, now);
  if (!decisions.length) return 0;
  const adopted = decisions.flatMap((d) => d.kind === "adopt" ? [{ postId: d.postId, network: networkOf(d.slotId.slice(0, d.slotId.lastIndexOf("@"))), text: open.find((o) => o.runId === d.runId && o.slotId === d.slotId)!.text, verdicts: null }] : []);
  if (adopted.length) await deps.record(userId, adopted);
  await deps.settle(userId, decisions);
  return decisions.length;
}
