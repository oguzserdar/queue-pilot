"use server";

import { revalidatePath } from "next/cache";
import { signedInUserId } from "@/lib/current-user";
import { postgresReviewStore } from "@/lib/review-store";
import { fixesForRule, rulesFromComments, shareDrafts, type ShownFix } from "@/lib/review-flow";
import type { FirstRuleOffer } from "@/app/(app)/actions";

export type { ShownFix };
const signedOut = { ok: false as const, message: "Sign in with Buffer first." };

/** Shares these drafts under a new review link. */
export async function shareForReview(postIds: string[]): Promise<{ ok: true; id: string } | { ok: false; message: string }> {
  const userId = await signedInUserId();
  if (!userId) return signedOut;
  const r = await shareDrafts(userId, postIds);
  if (r.ok) revalidatePath("/reviews");
  return r;
}

/** Turns a review link off: the page stops opening and takes no more comments. */
export async function turnOffReview(id: string): Promise<{ ok: boolean; message?: string }> {
  const userId = await signedInUserId();
  if (!userId) return signedOut;
  if (typeof id !== "string" || id.length > 100) return { ok: false, message: "Unknown link." };
  await postgresReviewStore().revoke(userId, id);
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
