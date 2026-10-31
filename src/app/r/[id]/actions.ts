"use server";

import { headers } from "next/headers";
import { clientIp } from "@/lib/client-ip";
import { limit } from "@/lib/rate-limit";
import { checkComment, postgresReviewStore, type CommentInput, type ReviewComment } from "@/lib/review-store";

/**
 * A comment from someone with the review link, who has no account. Limited per address and per link, checked against
 * the shared drafts, and refused once the link is off or full.
 */
export async function addReviewComment(linkId: string, input: CommentInput): Promise<{ ok: true; comments: ReviewComment[] } | { ok: false; message: string }> {
  if (typeof linkId !== "string" || linkId.length > 100) return { ok: false, message: "This review link is off." };
  const ip = clientIp(await headers());
  const [byIp, byLink] = await Promise.all([limit("reviewComment", ip), limit("reviewLink", linkId)]);
  if (!byIp.ok || !byLink.ok) return { ok: false, message: "Too many comments just now. Try again in a few minutes." };
  const store = postgresReviewStore();
  const link = await store.open(linkId);
  if (!link) return { ok: false, message: "This review link is off." };
  const checked = checkComment(link.drafts, input);
  if (!checked.ok) return checked;
  if (!(await store.comment(linkId, checked.comment))) return { ok: false, message: "This review is closed to new comments." };
  return { ok: true, comments: (await store.open(linkId))?.comments ?? [] };
}
