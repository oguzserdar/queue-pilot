"use server";

import { revalidatePath } from "next/cache";
import { signedInUserId } from "@/lib/current-user";
import { postgresReviewStore } from "@/lib/review-store";
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
export async function keepReviewPreference(token: string) {
  const userId = await signedInUserId();
  if (!userId) return signedOut;
  const { applySuggestion } = await import("@/lib/rule-suggestions");
  const r = await applySuggestion(userId, token, "keep");
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
