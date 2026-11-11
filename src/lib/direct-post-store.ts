/**
 * Post rows in Postgres. The (post, kind) primary key is the claim for a post sent at once; for scheduled posts the
 * due run claims rows with FOR UPDATE SKIP LOCKED, so any number of workers can run at the same time and each row is
 * taken by one of them. Every statement a person's action runs is scoped to their user id.
 */
import { and, desc, eq, inArray, isNull, lt, lte, ne, or, sql } from "drizzle-orm";
import { db } from "../db";
import { directPostSend } from "../db/schema";
import { CLAIM_MS, type DirectPostRow, type DirectPostStore } from "./direct-posts";
import { readPage, timeText, type Page, type PageFrom } from "./page-bookmark";

const toRow = (r: typeof directPostSend.$inferSelect): DirectPostRow => ({
  postId: r.postId, kind: r.kind, target: r.target, guildId: r.guildId, label: r.label, text: r.text, status: r.status,
  attempts: r.attempts, link: r.link, error: r.error, sendAt: r.sendAt, revision: r.revision, callStartedAt: r.callStartedAt,
  claimedUntil: r.claimedUntil, bufferPostId: r.bufferPostId, createdAt: r.createdAt, updatedAt: r.updatedAt,
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
          .set({ ...(change.sendAt ? { sendAt: change.sendAt, claimedUntil: null } : {}), ...(text !== undefined ? { text } : {}), revision: sql`${directPostSend.revision} + 1`, updatedAt: now })
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
    async defer(userId, postId, kind, when, now) {
      // A held row keeps its time (the one-day limit counts from it) and is not due again before holdUntil.
      await db()
        .update(directPostSend)
        .set({ status: "scheduled", ...(when.sendAt ? { sendAt: when.sendAt } : {}), claimedUntil: when.holdUntil ?? null, updatedAt: now })
        .where(and(mine(userId, postId), eq(directPostSend.kind, kind), eq(directPostSend.status, "pending"), sql`${directPostSend.callStartedAt} is null`));
    },
    async retryLater(userId, postId, kind, until, now) {
      // Only after Telegram or Discord refused with "wait": nothing was posted, so the call mark is cleared.
      await db()
        .update(directPostSend)
        .set({ status: "scheduled", claimedUntil: until, callStartedAt: null, updatedAt: now })
        .where(and(mine(userId, postId), eq(directPostSend.kind, kind), eq(directPostSend.status, "pending")));
    },
    async waitingFollowUps(userId, bufferPostIds) {
      if (!bufferPostIds.length) return [];
      return (await db().select().from(directPostSend).where(and(eq(directPostSend.userId, userId), inArray(directPostSend.bufferPostId, bufferPostIds), eq(directPostSend.status, "scheduled")))).map(toRow);
    },
    async followedPlaces(userId, bufferPostIds) {
      if (!bufferPostIds.length) return new Set();
      const rows = await db()
        .select({ id: directPostSend.bufferPostId, kind: directPostSend.kind })
        .from(directPostSend)
        .where(and(
          eq(directPostSend.userId, userId), inArray(directPostSend.bufferPostId, bufferPostIds), ne(directPostSend.status, "cancelled"),
          sql`not (${directPostSend.status} = 'failed' and ${directPostSend.callStartedAt} is null)`,
        ));
      return new Set(rows.map((r) => `${r.id}|${r.kind}`));
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
      const t = directPostSend;
      // Rows that are due and not held, or claimed by a worker that died before calling. SKIP LOCKED lets any number
      // of workers run at once; each row goes to one of them.
      const due = db()
        .select({ postId: t.postId, kind: t.kind })
        .from(t)
        .where(and(
          or(
            and(eq(t.status, "scheduled"), lte(t.sendAt, now), or(isNull(t.claimedUntil), lte(t.claimedUntil, now))),
            and(eq(t.status, "pending"), isNull(t.callStartedAt), lt(t.claimedUntil, now)),
          ),
          only ? and(eq(t.postId, only.postId), lte(t.revision, only.revision)) : undefined,
        ))
        .orderBy(sql`${t.sendAt} nulls first`)
        .limit(limit)
        .for("update", { skipLocked: true });
      const rows = await db()
        .update(t)
        .set({ status: "pending", claimedUntil: new Date(now.getTime() + CLAIM_MS), updatedAt: now })
        .where(sql`(${t.postId}, ${t.kind}) in ${due}`)
        .returning();
      return rows.map((r) => ({ ...toRow(r), userId: r.userId }));
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
        .where(and(mine(userId, postId), eq(directPostSend.kind, kind), eq(directPostSend.status, "failed"), isNull(directPostSend.bufferPostId)))
        .returning();
      return row ? toRow(row) : null;
    },
    async finish(userId, postId, kind, result, now) {
      await db()
        .update(directPostSend)
        .set({ status: result.status, link: result.link, error: result.error, updatedAt: now })
        .where(and(mine(userId, postId), eq(directPostSend.kind, kind), eq(directPostSend.status, "pending")));
    },
    async recent(userId, limit) {
      return (await db().select().from(directPostSend).where(eq(directPostSend.userId, userId)).orderBy(desc(directPostSend.createdAt)).limit(limit)).map(toRow);
    },
  };
}

/** Telegram and Discord posts per page in Settings, Channels. */
export const DIRECT_POST_PAGE_SIZE = 12;

/**
 * One page of the person's Telegram and Discord posts, newest first, for Settings, Channels. A post is one row per
 * place, so the tie-breaker is the post id and the place together.
 *
 * @param userId - The signed-in person
 * @param from - A bookmark from the page before or after; neither opens the newest page
 * @param limit - Posts per page
 */
export async function directPostPage(userId: string, from: PageFrom = {}, limit = DIRECT_POST_PAGE_SIZE): Promise<Page<DirectPostRow>> {
  const key = sql<string>`${directPostSend.postId} || '|' || ${directPostSend.kind}`;
  const page = await readPage({
    time: directPostSend.createdAt,
    key,
    from,
    limit,
    read: async (where, order, count) =>
      (await db().select({ row: directPostSend, at: timeText(directPostSend.createdAt), key }).from(directPostSend).where(and(eq(directPostSend.userId, userId), where)).orderBy(...order).limit(count)),
  });
  return { ...page, rows: page.rows.map(toRow) };
}
