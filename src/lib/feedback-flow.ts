import { tooLong } from "./char-limits";
import { createHash } from "node:crypto";
import { postgresReviewStore } from "./review-store";
import { postgresSnapshotStore } from "./buffer/snapshot-store";
import { wroteIds } from "./written-store";
import { postgresRulesStore } from "./rules-store";
import { planFeedback, type FeedbackPlan } from "./feedback-plan";
import { judgeModelFor } from "./judge-model";
import { applyPlaybook, type PlaybookCheck } from "./save-for-user";
import { judgeDrafts } from "./judge";
import { signSuggestion } from "./rule-suggestions";
import { limit } from "./rate-limit";
import type { OpenSlot } from "./open-slots";

export type FeedbackResult = FeedbackPlan & { suggestionToken: string | null; check: PlaybookCheck; refused: { postId: string; reason: string }[]; checked: number; flags: { postId: string; rule: string; reason: string }[] };
export async function feedbackForComment(userId: string, linkId: unknown, commentId: unknown, postIds: unknown): Promise<{ ok: true; plan: FeedbackResult } | { ok: false; message: string }> {
  if (typeof linkId !== "string" || typeof commentId !== "string" || !Array.isArray(postIds) || !postIds.length || postIds.length > 30 || postIds.some(p => typeof p !== "string" || p.length > 200)) return { ok: false, message: "Choose a comment and up to 30 drafts." };
  const [links, snap] = await Promise.all([postgresReviewStore().list(userId), postgresSnapshotStore().get(userId)]);
  const link = links.find(l => l.id === linkId);
  const comment = link?.comments.find(c => c.id === commentId);
  const original = link?.drafts.find(d => d.postId === comment?.postId);
  if (!comment || !original || !snap) return { ok: false, message: "That comment is not in your reviews." };
  const ids = new Set(postIds as string[]);
  const channels = new Map(snap.data.channels.map(c => [c.id, c]));
  const drafts = snap.data.posts.filter(p => ids.has(p.id) && p.status === "draft" && channels.has(p.channelId));
  const ours = await wroteIds(userId, ...ids);
  if (drafts.length !== ids.size || drafts.some(p => !ours.has(p.id))) return { ok: false, message: "Choose only drafts Queue Pilot wrote that are still drafts." };
  if (drafts.reduce((n, p) => n + p.text.length, 0) > 100_000) return { ok: false, message: "Choose fewer drafts for one review." };
  const l = await limit("ai", userId);
  if (!l.ok) return { ok: false, message: "Too many checks just now. Try again in a minute." };
  // Read the entire playbook before reserving AI; a database failure must never mean no rules.
  const rules = await postgresRulesStore().list(userId);
  const jm = await judgeModelFor(userId);
  if (!jm) return { ok: false, message: "AI is unavailable. Check the allowance or your own key in Settings." };
  try {
    const plan = await planFeedback(jm.language, { text: comment.text, quote: comment.quote, original: original.text }, drafts.map(p => ({ slotId: p.id, text: p.text, network: channels.get(p.channelId)!.service, channelId: p.channelId })));
    const slots = drafts.map(p => ({ id: p.id, service: channels.get(p.channelId)!.service, channelId: p.channelId })) as OpenSlot[];
    const lengthRefusals = plan.edits.flatMap(e => {
      const draft = drafts.find(p => p.id === e.postId)!;
      const reason = tooLong(channels.get(draft.channelId)!.service, e.after);
      return reason ? [{ postId: e.postId, reason }] : [];
    });
    const fitting = plan.edits.filter(e => !lengthRefusals.some(r => r.postId === e.postId));
    const gate = await applyPlaybook(fitting.map(e => ({ slotId: e.postId, text: e.after })), slots, rules, (d, r) => judgeDrafts(jm.judges, d, r));
    const allowed = new Set(gate.keep.map(d => d.slotId));
    // The offer stays on the selected exact accounts. Never silently widen a reviewer request to every profile.
    const accountIds = [...new Set(drafts.map(p => p.channelId))].sort();
    const suggestionToken = plan.preference ? signSuggestion(userId, {
      key: `review:${createHash("sha256").update(JSON.stringify([linkId, commentId, plan.preference, accountIds])).digest("hex")}`,
      rule: { kind: "guidance", text: plan.preference, channels: "all", accountIds, level: "warn" }, fixes: 0,
      evidence: { kind: "review", comment: comment.text, quote: comment.quote, reason: plan.reason, sharedAt: link!.createdAt, networks: [...new Set(drafts.map(p => channels.get(p.channelId)!.service))].sort() },
    }) : null;
    return { ok: true, plan: { ...plan, edits: plan.edits.filter(e => allowed.has(e.postId)), checked: gate.verdicts.size, check: gate.check, suggestionToken, refused: [...lengthRefusals, ...gate.refused.map(r => ({ postId: r.slotId, reason: r.reason }))], flags: [...gate.verdicts].flatMap(([postId, vs]) => vs.filter(v => v.verdict !== "pass").map(v => ({ postId, rule: v.rule, reason: v.reason }))) } };
  } catch (e) {
    await jm.giveBack();
    console.error(JSON.stringify({ event: "qp-feedback-failed", message: e instanceof Error ? e.message : String(e) }));
    return { ok: false, message: "Could not prepare those changes. Nothing was changed. Try again." };
  } finally { await jm.settle(); }
}
