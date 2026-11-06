/**
 * What Queue Pilot wrote: the saved text of each draft it put in Buffer, keyed by Buffer's post id. The read-back
 * compares it with the post's current text to find the person's fixes.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import { written } from "../db/schema";
import type { Verdict } from "./judge";

/**
 * verdicts: the playbook check the draft was saved with; null when it was saved unchecked. approvedBy: who approved it
 * for scheduling ("queue-pilot" for the person in the app, else the AI app's name), absent until approved.
 */
export type Written = { postId: string; network: string; text: string; verdicts?: Verdict[] | null; playbookRevision?: string | null; approvedBy?: string; approvedAt?: string };


export type WrittenStore = {
  /** Records drafts just saved; saving the same post again replaces its text. */
  record(userId: string, drafts: Written[]): Promise<void>;
  /** The recorded drafts among these post ids. */
  get(userId: string, postIds: string[]): Promise<Written[]>;
  /** Records who approved these drafts; only drafts Queue Pilot recorded writing for this person change. */
  markApproved(userId: string, postIds: string[], by: string): Promise<void>;
};

/** Written drafts in Postgres through Drizzle; every statement is scoped to the user id. */
export function postgresWrittenStore(): WrittenStore {
  return {
    async record(userId, drafts) {
      if (!drafts.length) return;
      await db()
        .insert(written)
        .values(drafts.map((d) => ({ userId, postId: d.postId, network: d.network, text: d.text.slice(0, 25_000), verdicts: d.verdicts ?? null, playbookRevision: d.playbookRevision ?? null })))
        .onConflictDoUpdate({ target: [written.userId, written.postId], set: { text: sql`excluded.text`, network: sql`excluded.network`, verdicts: sql`excluded.verdicts`, playbookRevision: sql`excluded.playbook_revision`, savedAt: sql`now()` } });
    },
    async get(userId, postIds) {
      if (!postIds.length) return [];
      const rows = await db().select().from(written).where(and(eq(written.userId, userId), inArray(written.postId, postIds)));
      return rows.map((r) => ({ postId: r.postId, network: r.network, text: r.text, verdicts: (r.verdicts as Verdict[] | null) ?? null, ...(r.playbookRevision ? { playbookRevision: r.playbookRevision } : {}), ...(r.approvedBy ? { approvedBy: r.approvedBy, approvedAt: r.approvedAt?.toISOString() } : {}) }));
    },
    async markApproved(userId, postIds, by) {
      if (!postIds.length) return;
      await db().update(written).set({ approvedBy: by.slice(0, 200), approvedAt: sql`now()` }).where(and(eq(written.userId, userId), inArray(written.postId, postIds)));
    },
  };
}

/** The subset of these post ids that Queue Pilot recorded writing for this person. */
export async function wroteIds(userId: string, ...postIds: string[]): Promise<Set<string>> {
  return new Set((await postgresWrittenStore().get(userId, postIds)).map((w) => w.postId));
}
