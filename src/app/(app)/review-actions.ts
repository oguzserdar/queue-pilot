"use server";

import { revalidatePath } from "next/cache";
import { signedInUserId } from "@/lib/current-user";
import { postgresReviewStore, TooManyLinksError } from "@/lib/review-store";
import { fixesForRule, rulesFromComments, shareDrafts, type ShownFix } from "@/lib/review-flow";
import type { FirstRuleOffer } from "@/app/(app)/actions";

export type { ShownFix };
const signedOut = { ok: false as const, message: "Sign in with Buffer first." };

/** Shares these drafts under a new review link. */
export async function shareForReview(postIds: string[], days = 7): Promise<{ ok: true; id: string } | { ok: false; message: string }> {
  const userId = await signedInUserId();
  if (!userId) return signedOut;
  const r = await shareDrafts(userId, postIds, days);
  if (r.ok) revalidatePath("/reviews");
  return r;
}

/** Turns a review link off: the page stops opening and takes no more comments. */
export async function turnOffReview(id: string): Promise<{ ok: boolean; message?: string }> {
  const userId = await signedInUserId();
  if (!userId) return signedOut;
  if (typeof id !== "string" || id.length > 100) return { ok: false, message: "Unknown link." };
  const changed = await postgresReviewStore().revoke(userId, id);
  if (!changed) return { ok: false, message: "No matching active review link." };
  revalidatePath("/reviews");
  return { ok: true };
}

/** Turns a review link back on: it opens again with its comments, and an expired one gets another 7 days. */
export async function turnOnReview(id: string): Promise<{ ok: true; expiresAt: string } | { ok: false; message: string }> {
  const userId = await signedInUserId();
  if (!userId) return signedOut;
  if (typeof id !== "string" || id.length > 100) return { ok: false, message: "Unknown link." };
  try {
    if (!(await postgresReviewStore().reopen(userId, id))) return { ok: false, message: "That link is already on." };
  } catch (e) {
    if (e instanceof TooManyLinksError) return { ok: false, message: e.message };
    throw e;
  }
  const link = (await postgresReviewStore().list(userId)).find((l) => l.id === id);
  revalidatePath("/reviews");
  return { ok: true, expiresAt: link?.expiresAt ?? new Date(Date.now() + 7 * 86_400_000).toISOString() };
}

/** Find rules in comments: only lasting requests come back, as rules to keep or skip. */
export async function findRulesInComments(): Promise<{ ok: true; offers: FirstRuleOffer[]; skipped: string[] } | { ok: false; message: string }> {
  const userId = await signedInUserId();
  return userId ? rulesFromComments(userId) : signedOut;
}

/** Carries a kept rule across the drafts Queue Pilot wrote, as rewrites to apply or leave. */
export async function proposeFixesForRule(ruleId: string): Promise<{ ok: true; fixes: ShownFix[]; checked: number } | { ok: false; message: string }> {
  const userId = await signedInUserId();
  return userId ? fixesForRule(userId, ruleId) : signedOut;
}

/** A comment proposes changes, separately from keeping a preference. */
export async function proposeCommentChanges(linkId: string, commentId: string, postIds: string[]) {
  const userId = await signedInUserId();
  if (!userId) return signedOut;
  const { feedbackForComment } = await import("@/lib/feedback-flow");
  return feedbackForComment(userId, linkId, commentId, postIds);
}
/** Teammates' Buffer notes on the person's open posts, with author, date, account and post. No AI is spent. */
export async function findTeamNotes(): Promise<{ ok: true; notes: import("@/lib/note-feedback").TeamNote[] } | { ok: false; message: string }> {
  const { bufferForReading } = await import("@/lib/current-user");
  const b = await bufferForReading();
  if (!b) return signedOut;
  const { limit } = await import("@/lib/rate-limit");
  const l = await limit("bufferWrite", b.userId);
  if (!l.ok) return { ok: false, message: `Too many requests just now. Try again in ${l.resetSeconds} seconds.` };
  try {
    const { teamNotes } = await import("@/lib/note-feedback");
    return { ok: true, notes: await teamNotes(b) };
  } catch (e) {
    const { NotesNotAllowedError } = await import("@/lib/buffer/notes");
    if (e instanceof NotesNotAllowedError) return { ok: false, message: e.message };
    console.error(JSON.stringify({ event: "qp-team-notes-failed", message: e instanceof Error ? e.message : String(e) }));
    return { ok: false, message: "Buffer did not answer. Try again in a minute." };
  }
}

/** One teammate's note, read from Buffer again, proposes changes to Queue Pilot's drafts on that note's account. */
export async function proposeNoteChanges(noteKey: string) {
  const userId = await signedInUserId();
  if (!userId) return signedOut;
  const { limit } = await import("@/lib/rate-limit");
  const l = await limit("bufferWrite", userId);
  if (!l.ok) return { ok: false as const, message: `Too many requests just now. Try again in ${l.resetSeconds} seconds.` };
  const { freshBufferForCurrentUser } = await import("@/lib/current-user");
  const b = await freshBufferForCurrentUser();
  if (!b) return signedOut;
  const { feedbackForNote } = await import("@/lib/note-feedback");
  return feedbackForNote(b.userId, async () => b, noteKey);
}

export async function keepReviewPreference(token: string, scope?: import("@/lib/rule-suggestions").KeepScope) {
  const userId = await signedInUserId();
  if (!userId) return signedOut;
  const { applySuggestion } = await import("@/lib/rule-suggestions");
  // A rule offered from a teammate's note is kept only if that note is still in Buffer, unchanged.
  const readNotes = async () => {
    const { limit } = await import("@/lib/rate-limit");
    if (!(await limit("bufferWrite", userId)).ok) throw new Error("Buffer limit reached");
    const { freshBufferForCurrentUser } = await import("@/lib/current-user");
    const b = await freshBufferForCurrentUser();
    if (!b) throw new Error("Signed out");
    const { allTeamNotes } = await import("@/lib/note-feedback");
    return allTeamNotes(b);
  };
  const r = await applySuggestion(userId, token, "keep", scope, readNotes);
  if (r.ok) revalidatePath("/playbook");
  return r;
}
export async function changeRuleOverride(ruleId: string, target: import("@/lib/rule-routing-store").RuleTarget, value: boolean | null) {
  const userId = await signedInUserId();
  if (!userId) return signedOut;
  const { setRuleOverride } = await import("@/lib/rule-routing-store");
  const ok = await setRuleOverride(userId, ruleId, target, value);
  if (ok) revalidatePath("/", "layout");
  return { ok, message: ok ? "Rule routing updated." : "That rule cannot be changed for this account." };
}
export async function changeInheritance(target: import("@/lib/rule-routing-store").RuleTarget, shared: boolean, network: boolean) {
  const userId = await signedInUserId();
  if (!userId) return signedOut;
  const { setInheritance } = await import("@/lib/rule-routing-store");
  const ok = await setInheritance(userId, target, shared, network);
  if (ok) revalidatePath("/", "layout");
  return { ok, message: ok ? "Inheritance updated." : "Choose an account connected to Queue Pilot." };
}
