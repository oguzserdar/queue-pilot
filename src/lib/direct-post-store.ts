/**
 * Post rows in Postgres. The (post, kind) primary key is the claim for a post sent at once; for scheduled posts the
 * due run claims rows with FOR UPDATE SKIP LOCKED, so any number of workers can run at the same time and each row is
 * taken by one of them. Every statement a person's action runs is scoped to their user id.
 */
import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { db } from "../db";
import { directPostSend } from "../db/schema";
import { CLAIM_MS, type PostKind, type DirectPostRow, type DirectPostStatus, type DirectPostStore, type DueRow } from "./direct-posts";

const toRow = (r: typeof directPostSend.$inferSelect): DirectPostRow => ({
  postId: r.postId, kind: r.kind, target: r.target, guildId: r.guildId, label: r.label, text: r.text, status: r.status,
  attempts: r.attempts, link: r.link, error: r.error, sendAt: r.sendAt, revision: r.revision, callStartedAt: r.callStartedAt,
  claimedUntil: r.claimedUntil, bufferPostId: r.bufferPostId, createdAt: r.createdAt, updatedAt: r.updatedAt,
});

type Raw = {
  announcement_id: string; user_id: string; kind: PostKind; target: string; guild_id: string | null; label: string; text: string; status: DirectPostStatus;
  attempts: number; link: string | null; error: string | null; send_at: string | Date | null; revision: number;
  call_started_at: string | Date | null; claimed_until: string | Date | null; buffer_post_id: string | null; created_at: string | Date; updated_at: string | Date;
};
const date = (v: string | Date | null) => (v === null ? null : new Date(v));
const fromRaw = (r: Raw): DueRow => ({
  postId: r.announcement_id, userId: r.user_id, kind: r.kind, target: r.target, guildId: r.guild_id, label: r.label, text: r.text, status: r.status,
  attempts: r.attempts, link: r.link, error: r.error, sendAt: date(r.send_at), revision: r.revision, callStartedAt: date(r.call_started_at), claimedUntil: date(r.claimed_until), bufferPostId: r.buffer_post_id,
  createdAt: new Date(r.created_at), updatedAt: new Date(r.updated_at),
});
const mine = (userId: string, postId: string) => and(eq(directPostSend.userId, userId), eq(directPostSend.postId, postId));

export function postgresDirectPostStore(): DirectPostStore {
  return {
    async claim(userId, postId, item, now) {
      const rows = await db()
        .insert(directPostSend)
        .values({ postId, userId, kind: item.kind, target: item.target, label: item.label, text: item.text, guildId: item.guildId ?? null, status: "pending", claimedUntil: new Date(now.getTime() + CLAIM_MS), createdAt: now, updatedAt: now })
        .onConflictDoNothing()
        .returning({ id: directPostSend.postId });
      return rows.length === 1;
    },
    async schedule(userId, postId, item, sendAt, now, bufferPostId) {
      const rows = await db()
        .insert(directPostSend)
        .values({ postId, userId, kind: item.kind, target: item.target, label: item.label, text: item.text, guildId: item.guildId ?? null, status: "scheduled", sendAt, bufferPostId: bufferPostId ?? null, createdAt: now, updatedAt: now })
        .onConflictDoNothing()
        .returning({ id: directPostSend.postId });
      return rows.length === 1;
    },
    async reschedule(userId, postId, change, now) {
      const out: DirectPostRow[] = [];
      for (const kind of ["telegram", "discord"] as const) {
        const text = change.texts?.[kind];
        const rows = await db()
          .update(directPostSend)
          .set({ ...(change.sendAt ? { sendAt: change.sendAt } : {}), ...(text !== undefined ? { text } : {}), revision: sql`${directPostSend.revision} + 1`, updatedAt: now })
          .where(and(mine(userId, postId), eq(directPostSend.kind, kind), eq(directPostSend.status, "scheduled")))
          .returning();
        out.push(...rows.map(toRow));
      }
      return out;
    },
    async follow(userId, postId, item, sendAt, now, bufferPostId) {
      // One statement: a new place is inserted; a waiting or cancelled one of this person's takes the new text and
      // time with a new revision; anything already sent, sending or failed is left alone.
      const rows = await db()
        .insert(directPostSend)
        .values({ postId, userId, kind: item.kind, target: item.target, label: item.label, text: item.text, guildId: item.guildId ?? null, status: "scheduled", sendAt, bufferPostId, createdAt: now, updatedAt: now })
        .onConflictDoUpdate({
          target: [directPostSend.postId, directPostSend.kind],
          set: { target: item.target, label: item.label, text: item.text, guildId: item.guildId ?? null, status: "scheduled", sendAt, revision: sql`${directPostSend.revision} + 1`, claimedUntil: null, callStartedAt: null, updatedAt: now },
          setWhere: sql`${directPostSend.userId} = ${userId} and ${directPostSend.status} in ('scheduled', 'cancelled')`,
        })
        .returning({ id: directPostSend.postId });
      return rows.length === 1;
    },
    async unfollow(userId, postId, kind, now) {
      await db()
        .update(directPostSend)
        .set({ status: "cancelled", revision: sql`${directPostSend.revision} + 1`, updatedAt: now })
        .where(and(mine(userId, postId), eq(directPostSend.kind, kind), eq(directPostSend.status, "scheduled")));
    },
    async defer(userId, postId, kind, sendAt, now) {
      await db()
        .update(directPostSend)
        .set({ status: "scheduled", sendAt, claimedUntil: null, updatedAt: now })
        .where(and(mine(userId, postId), eq(directPostSend.kind, kind), eq(directPostSend.status, "pending"), sql`${directPostSend.callStartedAt} is null`));
    },
    async followedBufferPosts(userId, bufferPostIds) {
      if (!bufferPostIds.length) return new Set();
      const rows = await db()
        .selectDistinct({ id: directPostSend.bufferPostId })
        .from(directPostSend)
        .where(and(eq(directPostSend.userId, userId), inArray(directPostSend.bufferPostId, bufferPostIds), ne(directPostSend.status, "cancelled")));
      return new Set(rows.map((r) => r.id!).filter(Boolean));
    },
    async cancel(userId, postId, now) {
      const rows = await db()
        .update(directPostSend)
        .set({ status: "cancelled", revision: sql`${directPostSend.revision} + 1`, updatedAt: now })
        .where(and(mine(userId, postId), eq(directPostSend.status, "scheduled")))
        .returning({ id: directPostSend.postId });
      return rows.length;
    },
    async claimDue(now, limit, only) {
      const until = new Date(now.getTime() + CLAIM_MS);
      const onlyClause = only ? sql`and announcement_id = ${only.postId} and revision = ${only.revision}` : sql``;
      const res = await db().execute(sql`
        update qp_announcement_send s set status = 'pending', claimed_until = ${until}, updated_at = ${now}
        where (s.announcement_id, s.kind) in (
          select announcement_id, kind from qp_announcement_send
          where ((status = 'scheduled' and send_at <= ${now})
             or (status = 'pending' and call_started_at is null and claimed_until < ${now}))
            ${onlyClause}
          order by send_at nulls first
          limit ${limit}
          for update skip locked
        )
        returning s.*`);
      const rows = (Array.isArray(res) ? res : (res as unknown as { rows: Raw[] }).rows) as Raw[];
      return rows.map(fromRaw);
    },
    async startCall(userId, postId, kind, now) {
      const rows = await db()
        .update(directPostSend)
        .set({ callStartedAt: now, updatedAt: now })
        .where(and(mine(userId, postId), eq(directPostSend.kind, kind), eq(directPostSend.status, "pending"), sql`${directPostSend.callStartedAt} is null`))
        .returning({ id: directPostSend.postId });
      return rows.length === 1;
    },
    async rows(userId, postId) {
      return (await db().select().from(directPostSend).where(mine(userId, postId))).map(toRow);
    },
    async reclaimFailed(userId, postId, kind, now) {
      // One statement: only a failed row of this user's flips back to pending, so two resends cannot both win.
      const [row] = await db()
        .update(directPostSend)
        .set({ status: "pending", attempts: sql`${directPostSend.attempts} + 1`, error: null, callStartedAt: null, claimedUntil: new Date(now.getTime() + CLAIM_MS), updatedAt: now })
        .where(and(mine(userId, postId), eq(directPostSend.kind, kind), eq(directPostSend.status, "failed")))
        .returning();
      return row ? toRow(row) : null;
    },
    async finish(userId, postId, kind, result, now) {
      await db()
        .update(directPostSend)
        .set({ status: result.status, link: result.link, error: result.error, updatedAt: now })
        .where(and(mine(userId, postId), eq(directPostSend.kind, kind)));
    },
    async recent(userId, limit) {
      return (await db().select().from(directPostSend).where(eq(directPostSend.userId, userId)).orderBy(desc(directPostSend.createdAt)).limit(limit)).map(toRow);
    },
  };
}
