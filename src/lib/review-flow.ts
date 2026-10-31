/**
 * The review flow behind both the screens (src/app/(app)/review-actions.ts) and the connector (src/lib/mcp-controls.ts):
 * share drafts under a review link, turn reviewers' comments into suggested rules, and carry a kept rule across the
 * drafts Queue Pilot wrote. Every function acts for the given person only.
 */
import { APICallError, NoObjectGeneratedError } from "ai";
import { postgresSnapshotStore } from "./buffer/snapshot-store";
import { postgresReviewStore, reviewNotes, TooManyLinksError, MAX_SHARED_DRAFTS, type SharedDraft } from "./review-store";
import { postgresRulesStore } from "./rules-store";
import { NETWORKS } from "./rules";
import { firstRuleKey, proposeFirstRules, type FirstRuleProof } from "./day-one-rules";
import { AiCapError, judgeModelFor } from "./judge-model";
import { aiErrorMessage } from "./ai-model";
import { limit } from "./rate-limit";
import { wroteIds } from "./written-store";
import { MAX_FIX_DRAFTS, proposeRuleFixes, type FixProposal } from "./rule-fixes";

/** A rule suggested from comments, as the rule finder shows it. */
export type RuleOffer = { text: string; channels: string[]; where: string; key: string; proof: FirstRuleProof };

/** Shares these drafts (ids are lookup keys, checked against the person's own drafts) from the saved copy of the person's Buffer under a new review link. */
export async function shareDrafts(userId: string, postIds: unknown): Promise<{ ok: true; id: string } | { ok: false; message: string }> {
  if (!Array.isArray(postIds) || !postIds.length || postIds.length > MAX_SHARED_DRAFTS || postIds.some((id) => typeof id !== "string")) {
    return { ok: false, message: `Choose between 1 and ${MAX_SHARED_DRAFTS} drafts.` };
  }
  const l = await limit("bufferWrite", userId);
  if (!l.ok) return { ok: false, message: `Too many requests just now. Try again in ${l.resetSeconds} seconds.` };
  try {
    const snap = await postgresSnapshotStore().get(userId);
    if (!snap) return { ok: false, message: "Queue Pilot has not read your Buffer yet. Open Next week first." };
    const channels = new Map(snap.data.channels.map((c) => [c.id, c]));
    // Only the person's own drafts, as they were last read from Buffer; ids are lookup keys, not proof.
    const drafts: SharedDraft[] = snap.data.posts
      .filter((p) => postIds.includes(p.id) && p.status === "draft" && channels.has(p.channelId))
      .map((p) => ({ postId: p.id, network: channels.get(p.channelId)!.service, channel: channels.get(p.channelId)!.name, dueAt: p.dueAt, text: p.text }));
    if (drafts.length !== new Set(postIds).size) return { ok: false, message: "Some of those drafts are no longer in Buffer. Refresh and try again." };
    const link = await postgresReviewStore().create(userId, drafts);
    return { ok: true, id: link.id };
  } catch (e) {
    if (e instanceof TooManyLinksError) return { ok: false, message: e.message };
    console.error(JSON.stringify({ event: "qp-share-review-failed", message: e instanceof Error ? e.message : String(e) }));
    return { ok: false, message: "Queue Pilot could not share that just now. Try again in a minute." };
  }
}

/** Find rules in comments: a model reads reviewers' comments as notes, and only lasting requests come back as rules to keep or skip. */
export async function rulesFromComments(userId: string): Promise<{ ok: true; offers: RuleOffer[]; skipped: string[] } | { ok: false; message: string }> {
  const l = await limit("ai", userId);
  if (!l.ok) return { ok: false, message: `Too many requests just now. Try again in ${l.resetSeconds} seconds.` };
  const posts = reviewNotes(await postgresReviewStore().list(userId));
  // No comments, no AI action spent.
  if (!posts.length) return { ok: false, message: "No comments yet. Share a review link first." };
  const jm = await judgeModelFor(userId).catch((e) => (e instanceof AiCapError ? e : null));
  if (jm instanceof AiCapError) return { ok: false, message: jm.message };
  if (!jm) return { ok: false, message: "Add your AI key in Settings: a model reads the comments." };
  try {
    const [rules, dismissed] = await Promise.all([postgresRulesStore().list(userId).catch(() => []), postgresRulesStore().dismissed(userId).catch(() => new Set<string>())]);
    const { offers } = await proposeFirstRules(jm.judges.explainer, jm.judges, posts, rules, { notesOnly: true });
    return {
      ok: true,
      skipped: [],
      offers: offers.filter(({ rule }) => !dismissed.has(firstRuleKey(rule))).map(({ rule, proof }) => {
        const channels = rule.channels === "all" ? [] : rule.channels;
        return { text: rule.text, channels, where: channels.map((c) => NETWORKS[c] ?? c).join(", "), key: firstRuleKey(rule), proof };
      }),
    };
  } catch (e) {
    await jm.giveBack();
    if (APICallError.isInstance(e) || NoObjectGeneratedError.isInstance(e)) return { ok: false, message: aiErrorMessage(e, jm.cfg.provider) };
    console.error(JSON.stringify({ event: "qp-review-rules-failed", message: e instanceof Error ? e.message : String(e) }));
    return { ok: false, message: "Could not read the comments just now. Try again." };
  } finally {
    await jm.settle();
  }
}

/** A proposed rewrite, with the words that name its draft. */
export type ShownFix = FixProposal & { label: string };

/**
 * Carries a kept rule across the week: the drafts Queue Pilot wrote that are still drafts in Buffer are judged
 * against it, and each one that breaks it comes back with a rewrite to apply or leave. One AI action.
 */
export async function fixesForRule(userId: string, ruleId: unknown): Promise<{ ok: true; fixes: ShownFix[]; checked: number } | { ok: false; message: string }> {
  if (typeof ruleId !== "string" || ruleId.length > 100) return { ok: false, message: "Unknown rule." };
  const l = await limit("ai", userId);
  if (!l.ok) return { ok: false, message: `Too many requests just now. Try again in ${l.resetSeconds} seconds.` };
  const [rule, snap] = await Promise.all([
    postgresRulesStore().list(userId).then((rs) => rs.find((r) => r.id === ruleId)),
    postgresSnapshotStore().get(userId),
  ]);
  if (!rule) return { ok: false, message: "That rule is no longer in your playbook." };
  if (!snap) return { ok: false, message: "Queue Pilot has not read your Buffer yet. Open Next week first." };
  const channels = new Map(snap.data.channels.map((c) => [c.id, c]));
  const candidates = snap.data.posts.filter((p) => p.status === "draft" && channels.has(p.channelId));
  // Only drafts Queue Pilot wrote: the person's own drafts are theirs to change.
  const ours = await wroteIds(userId, ...candidates.map((p) => p.id));
  const drafts = candidates.filter((p) => ours.has(p.id)).slice(0, MAX_FIX_DRAFTS);
  // No drafts, no AI action spent.
  if (!drafts.length) return { ok: true, fixes: [], checked: 0 };
  const jm = await judgeModelFor(userId).catch((e) => (e instanceof AiCapError ? e : null));
  if (jm instanceof AiCapError) return { ok: false, message: jm.message };
  if (!jm) return { ok: false, message: "Add your AI key in Settings: a model checks the drafts." };
  try {
    const fixes = await proposeRuleFixes(jm.judges, jm.language, drafts.map((p) => ({ slotId: p.id, text: p.text, network: channels.get(p.channelId)!.service })), rule);
    const label = (postId: string) => {
      const p = drafts.find((d) => d.id === postId)!;
      const c = channels.get(p.channelId)!;
      return `${c.name}${p.dueAt ? `, ${new Date(p.dueAt).toLocaleString("en-GB", { weekday: "long", hour: "2-digit", minute: "2-digit", timeZone: c.timezone || "UTC" })}` : ""}`;
    };
    return { ok: true, checked: drafts.length, fixes: fixes.map((f) => ({ ...f, label: label(f.postId) })) };
  } catch (e) {
    await jm.giveBack();
    if (APICallError.isInstance(e) || NoObjectGeneratedError.isInstance(e)) return { ok: false, message: aiErrorMessage(e, jm.cfg.provider) };
    console.error(JSON.stringify({ event: "qp-rule-fixes-failed", message: e instanceof Error ? e.message : String(e) }));
    return { ok: false, message: "Could not check your drafts just now. Try again." };
  } finally {
    await jm.settle();
  }
}
