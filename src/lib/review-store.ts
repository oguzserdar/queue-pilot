/**
 * Review links: the person picks drafts and shares one unguessable link. Anyone with the link reads those drafts and
 * comments, without an account, and the person can turn the link off. The drafts are copied when shared, so a
 * reviewer never reaches Buffer. Comments are untrusted text: they only become suggested rules (reviewNotes, read by
 * src/lib/day-one-rules.ts as notes) that the person keeps or skips.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, gt, sql } from "drizzle-orm";
import { user } from "../db/auth-schema";
import { db } from "../db";
import { reviewComment, reviewLink } from "../db/schema";
import type { PastPost } from "./day-one-rules";
import { MAX_COMMENT, MAX_COMMENTS, MAX_NAME, MAX_OPEN_LINKS, MAX_SHARED_DRAFTS, type ReviewComment, type ReviewLink, type SharedDraft } from "./review-limits";

export type { ReviewComment, ReviewLink, SharedDraft } from "./review-limits";
export { MAX_COMMENT, MAX_COMMENTS, MAX_NAME, MAX_OPEN_LINKS, MAX_SHARED_DRAFTS } from "./review-limits";

export class TooManyLinksError extends Error {
  constructor() {
    super(`You have ${MAX_OPEN_LINKS} review links on. Turn one off to share again.`);
  }
}

/** A comment as a reviewer sends it, before it is checked. */
export type CommentInput = { postId: unknown; name: unknown; text: unknown; start?: unknown; end?: unknown };

/**
 * Checks a reviewer's comment against the shared drafts. A highlight must be a real span of that draft's text; the
 * quote is taken from the shared text, never from the reviewer.
 *
 * @returns The comment to store, or the reason it was refused
 */
export function checkComment(drafts: SharedDraft[], input: CommentInput): { ok: true; comment: Omit<ReviewComment, "id" | "createdAt"> } | { ok: false; message: string } {
  if (!input || typeof input !== "object") return { ok: false, message: "Write a comment first." };
  const draft = typeof input.postId === "string" ? drafts.find((d) => d.postId === input.postId) : undefined;
  if (!draft) return { ok: false, message: "That draft is not in this review." };
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!name || name.length > MAX_NAME) return { ok: false, message: `Add your name, up to ${MAX_NAME} characters.` };
  const text = typeof input.text === "string" ? input.text.trim() : "";
  if (!text || text.length > MAX_COMMENT) return { ok: false, message: `Write a comment, up to ${MAX_COMMENT} characters.` };
  const hasStart = input.start !== undefined && input.start !== null;
  const hasEnd = input.end !== undefined && input.end !== null;
  if (!hasStart && !hasEnd) return { ok: true, comment: { postId: draft.postId, name, text, quote: null, start: null, end: null } };
  const start = input.start;
  const end = input.end;
  if (!Number.isInteger(start) || !Number.isInteger(end) || (start as number) < 0 || (end as number) <= (start as number) || (end as number) > draft.text.length) {
    return { ok: false, message: "Highlight the words again." };
  }
  return { ok: true, comment: { postId: draft.postId, name, text, quote: draft.text.slice(start as number, end as number), start: start as number, end: end as number } };
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);
const toLink = (r: typeof reviewLink.$inferSelect): ReviewLink => ({ id: r.id, drafts: r.drafts as SharedDraft[], createdAt: r.createdAt.toISOString(), revokedAt: iso(r.revokedAt), expiresAt: r.expiresAt.toISOString() });
const toComment = (r: typeof reviewComment.$inferSelect): ReviewComment => ({ id: r.id, postId: r.postId, name: r.name, text: r.text, quote: r.quote, start: r.start, end: r.end, createdAt: r.createdAt.toISOString() });

/** Review links in Postgres. */
export function postgresReviewStore() {
  return {
    /** Shares these drafts under a new link; the id is 32 random bytes, so the link cannot be guessed. */
    async create(userId: string, drafts: SharedDraft[], days = 7): Promise<ReviewLink> {
      if (!drafts.length || drafts.length > MAX_SHARED_DRAFTS || ![1, 7, 30].includes(days)) throw new Error("Choose drafts and a valid expiry.");
      return db().transaction(async tx => {
        // Serialize creation for one owner; counting alone races with another create.
        await tx.select({ id: user.id }).from(user).where(eq(user.id, userId)).for("update");
        const [{ open }] = await tx.select({ open: sql<number>`count(*)::int` }).from(reviewLink).where(and(eq(reviewLink.userId, userId), isNull(reviewLink.revokedAt), gt(reviewLink.expiresAt, new Date())));
        if (open >= MAX_OPEN_LINKS) throw new TooManyLinksError();
        const [row] = await tx.insert(reviewLink).values({ id: randomBytes(32).toString("base64url"), userId, drafts, expiresAt: new Date(Date.now() + days * 86_400_000) }).returning();
        return toLink(row);
      });
    },
    /** The person's links, newest first, with the comments on each. */
    async list(userId: string): Promise<(ReviewLink & { comments: ReviewComment[] })[]> {
      const links = await db().select().from(reviewLink).where(eq(reviewLink.userId, userId)).orderBy(desc(reviewLink.createdAt));
      if (!links.length) return [];
      const comments = await db().select().from(reviewComment).where(inArray(reviewComment.linkId, links.map((l) => l.id))).orderBy(asc(reviewComment.createdAt));
      return links.map((l) => ({ ...toLink(l), comments: comments.filter((c) => c.linkId === l.id).map(toComment) }));
    },
    /** Turns a link off for good. Only its owner can. */
    async revoke(userId: string, id: string): Promise<boolean> {
      const rows = await db().update(reviewLink).set({ revokedAt: new Date() }).where(and(eq(reviewLink.id, id), eq(reviewLink.userId, userId), isNull(reviewLink.revokedAt))).returning({ id: reviewLink.id });
      return rows.length > 0;
    },
    /** A link that is still on, with its comments, for the public page; null when it is off or never existed. */
    async open(id: string): Promise<(ReviewLink & { comments: ReviewComment[] }) | null> {
      const [l] = await db().select().from(reviewLink).where(and(eq(reviewLink.id, id), isNull(reviewLink.revokedAt), gt(reviewLink.expiresAt, new Date())));
      if (!l) return null;
      const comments = await db().select().from(reviewComment).where(eq(reviewComment.linkId, id)).orderBy(asc(reviewComment.createdAt));
      return { ...toLink(l), comments: comments.map(toComment) };
    },
    /** Serialize comment insertion and revocation on the link row. Recheck expiry, target and limits under the lock. */
    async comment(linkId: string, c: Omit<ReviewComment, "id" | "createdAt">): Promise<boolean> {
      return db().transaction(async tx => {
        const [link] = await tx.select().from(reviewLink).where(eq(reviewLink.id, linkId)).for("update");
        if (!link || link.revokedAt || link.expiresAt.getTime() <= Date.now()) return false;
        const checked = checkComment(link.drafts as SharedDraft[], c);
        if (!checked.ok) return false;
        const [{ count }] = await tx.select({ count: sql<number>`count(*)::int` }).from(reviewComment).where(eq(reviewComment.linkId, linkId));
        if (count >= MAX_COMMENTS) return false;
        await tx.insert(reviewComment).values({ id: randomUUID(), linkId, ...checked.comment });
        return true;
      });
    },
  };
}

/**
 * Every shared draft that has comments, with each comment as a note on it, for proposeFirstRules with `notesOnly`.
 * A comment on highlighted words names them, so the rule can say which words it means.
 */
export function reviewNotes(links: (ReviewLink & { comments: ReviewComment[] })[]): PastPost[] {
  return links.slice(0, 10).flatMap((l) =>
    l.drafts.slice(0, 10).flatMap((d) => {
      const on = l.comments.filter((c) => c.postId === d.postId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 3).reverse();
      return on.length
        ? [{ id: `${l.id}:${d.postId}`, ...(d.channelId ? { channelId: d.channelId } : {}), network: d.network, text: d.text.slice(0, 5000), notes: on.map((c) => ({ text: c.quote ? `On the words "${c.quote}": ${c.text}` : c.text, by: c.name, at: c.createdAt })) }]
        : [];
    }),
  ).slice(0, 10);
}
