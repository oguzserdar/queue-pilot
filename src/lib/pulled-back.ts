/**
 * @fileoverview Posts the person took off the schedule in Buffer. Buffer sends no notice when a post changes
 * (developers.buffer.com/reference.md, read 15 Nov 2026: no post webhooks), so Queue Pilot learns it by comparing two
 * reads of the person's Buffer: scheduled in the earlier one, a draft in the later one. Such a post is left out of
 * "Approve all" and an AI app can never schedule it; the person can still approve it on its own card. The mark goes
 * when the post is seen in any status other than draft (approved again, sent, failed).
 */
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import { pulledBack } from "../db/schema";

type Seen = { id: string; status: string };

/**
 * What changed between two reads.
 *
 * @param before - The posts in the earlier read; null when there was none (nothing is marked from a first read)
 * @param after - The posts in the later read
 * @returns mark: scheduled before and a draft now; clear: seen now in any status other than draft
 */
export function pulledBackBetween(before: Seen[] | null, after: Seen[]): { mark: string[]; clear: string[] } {
  const was = new Map((before ?? []).map((p) => [p.id, p.status]));
  return {
    mark: after.filter((p) => p.status === "draft" && was.get(p.id) === "scheduled").map((p) => p.id),
    clear: after.filter((p) => p.status !== "draft").map((p) => p.id),
  };
}

/**
 * Posts Queue Pilot approved that Buffer now shows as drafts. The person took them off the schedule, whether or not
 * Queue Pilot saw them scheduled in between. This is the only signal the live 1.0 site has, so a database upgraded
 * from it keeps every post it already treats as pulled back.
 */
export function approvedThenDraft(written: { postId: string; approvedBy?: string | null }[], posts: Seen[]): string[] {
  const approved = new Set(written.filter((w) => w.approvedBy).map((w) => w.postId));
  return posts.filter((p) => p.status === "draft" && approved.has(p.id)).map((p) => p.id);
}

/** Every post the person took off the schedule: the stored marks plus approved posts that are drafts again. */
export async function pulledBackFor(userId: string, written: { postId: string; approvedBy?: string | null }[], posts: Seen[], store: PulledBackStore = postgresPulledBackStore()): Promise<Set<string>> {
  const marks = await store.list(userId);
  for (const id of approvedThenDraft(written, posts)) marks.add(id);
  return marks;
}

/** Where the marks are kept. */
export type PulledBackStore = {
  apply(userId: string, change: { mark: string[]; clear: string[] }): Promise<void>;
  list(userId: string): Promise<Set<string>>;
};

/** The marks in Postgres. */
export function postgresPulledBackStore(): PulledBackStore {
  return {
    async apply(userId, { mark, clear }) {
      await db().transaction(async (tx) => {
        if (clear.length) await tx.delete(pulledBack).where(and(eq(pulledBack.userId, userId), inArray(pulledBack.postId, clear)));
        if (mark.length) await tx.insert(pulledBack).values(mark.map((postId) => ({ userId, postId }))).onConflictDoNothing();
      });
    },
    async list(userId) {
      const rows = await db().select({ postId: pulledBack.postId }).from(pulledBack).where(eq(pulledBack.userId, userId));
      return new Set(rows.map((r) => r.postId));
    },
  };
}
