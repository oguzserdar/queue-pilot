/**
 * Where the reply run last read each account's mentions (qp_reply_cursor, src/db/schema.ts). Taking an account for a
 * read is one conditional statement, so two runs never read the same account at once, and an account is never read
 * more often than its network allows.
 */
import { and, eq, notInArray, sql } from "drizzle-orm";
import { db } from "../db";
import { replyCursor } from "../db/schema";

export type ReplyCursor = typeof replyCursor.$inferSelect;

/** What a finished read moves the cursor to; fields left out stay as they were. */
export type CursorUpdate = { cursor?: string | null; seenUri?: string | null; seenAt?: Date | null };

/** Reply cursors in Postgres through Drizzle. Every statement is scoped to the account's owner. */
export function postgresReplyCursorStore() {
  return {
    /**
     * Takes one account for a read. Returns the cursor as it stood (primedAt null: never read, so this read answers
     * nothing), or null when another run read it less than `minGapMs` ago.
     */
    async take(userId: string, accountId: string, now: Date, minGapMs: number): Promise<ReplyCursor | null> {
      const before = new Date(now.getTime() - minGapMs);
      // The old row is read in the same statement, so the caller sees the cursor this take started from.
      const rows = await db().execute<{ primed_at: string | null; cursor: string | null; seen_uri: string | null; seen_at: string | null }>(sql`
        with old as (select primed_at, cursor, seen_uri, seen_at from ${replyCursor} where account_id = ${accountId} and user_id = ${userId}),
        taken as (
          insert into ${replyCursor} (account_id, user_id, polled_at) values (${accountId}, ${userId}, ${now.toISOString()}::timestamptz)
          on conflict (account_id) do update set polled_at = excluded.polled_at
          where ${replyCursor}.user_id = ${userId} and ${replyCursor}.polled_at < ${before.toISOString()}::timestamptz
          returning account_id
        )
        select old.primed_at, old.cursor, old.seen_uri, old.seen_at from taken left join old on true`);
      const row = rows.rows[0];
      if (!row) return null;
      const date = (v: string | null) => (v === null ? null : new Date(v));
      return { accountId, userId, primedAt: date(row.primed_at), cursor: row.cursor, seenUri: row.seen_uri, seenAt: date(row.seen_at), polledAt: now };
    },

    /** Records where a read got to. The first read also marks the account primed from now on. */
    async save(userId: string, accountId: string, update: CursorUpdate, primedAt: Date): Promise<void> {
      await db()
        .update(replyCursor)
        .set({ ...update, primedAt: sql`coalesce(${replyCursor.primedAt}, ${primedAt.toISOString()}::timestamptz)` })
        .where(and(eq(replyCursor.accountId, accountId), eq(replyCursor.userId, userId)));
    },

    /**
     * Forgets the cursor of every account not in `activeIds` (the accounts with replies on and not broken), so turning
     * replies on again or reconnecting starts with a read that answers nothing. Returns how many were forgotten.
     */
    async forgetInactive(activeIds: string[]): Promise<number> {
      const rows = await db()
        .delete(replyCursor)
        .where(activeIds.length ? notInArray(replyCursor.accountId, activeIds) : sql`true`)
        .returning({ id: replyCursor.accountId });
      return rows.length;
    },
  };
}

export type ReplyCursorStore = ReturnType<typeof postgresReplyCursorStore>;

