/**
 * Post rows in Postgres. The (post, kind) primary key is the claim for a post sent at once; for scheduled posts the
 * due run claims rows with FOR UPDATE SKIP LOCKED, so any number of workers can run at the same time and each row is
 * taken by one of them. Every statement a person's action runs is scoped to their user id.
 */
import { and, asc, desc, eq, inArray, isNull, lt, lte, ne, or, sql } from "drizzle-orm";
import { db } from "../db";
import { directPostSend } from "../db/schema";
import { CLAIM_MS, ONE_PER_POST, WAIT_CEILING, textFor, type DirectPostRow, type DirectPostStore, type Place } from "./direct-posts";
import { readPage, timeText, type Page, type PageFrom } from "./page-bookmark";
import { SOCIAL_NETWORKS } from "./social-networks";

/** Direct posts go to Telegram, Discord, Mastodon or Bluesky; Instagram posts go through Buffer, so any other kind here is a bug. */
function postKind(kind: (typeof directPostSend.$inferSelect)["kind"]): DirectPostRow["kind"] {
  if (kind === "instagram") throw new Error("Unexpected direct post kind instagram");
  return kind;
}
const toRow = (r: typeof directPostSend.$inferSelect): DirectPostRow => ({
  postId: r.postId, kind: postKind(r.kind), target: r.target, guildId: r.guildId, label: r.label, text: r.text, status: r.status,
  attempts: r.attempts, waits: r.waits, link: r.link, error: r.error, sendAt: r.sendAt, revision: r.revision, callStartedAt: r.callStartedAt,
  claimedUntil: r.claimedUntil, bufferPostId: r.bufferPostId, createdAt: r.createdAt, updatedAt: r.updatedAt,
});

const mine = (userId: string, postId: string) => and(eq(directPostSend.userId, userId), eq(directPostSend.postId, postId));

/** The row of one place: by kind for Telegram and Discord (one per post), by kind and account for the others. */
const at = (p: Place) => (ONE_PER_POST.has(p.kind) ? eq(directPostSend.kind, p.kind) : and(eq(directPostSend.kind, p.kind), eq(directPostSend.target, p.target)));

type Planning = Pick<DirectPostStore, "claim" | "schedule" | "reschedule" | "follow" | "unfollow" | "defer" | "retryLater" | "waitingFollowUps" | "followedPlaces">;
type Cancelling = Pick<DirectPostStore, "cancelKind" | "cancel">;

/** Writing, scheduling, following and cancelling rows. */
function planning(): Planning {
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
      // Each waiting row of the post, every kind: the new time for all, and each row's own text (by account, else by kind).
      const waiting = await db().select({ kind: directPostSend.kind, target: directPostSend.target }).from(directPostSend).where(and(mine(userId, postId), eq(directPostSend.status, "scheduled")));
      const out: DirectPostRow[] = [];
      for (const w of waiting) {
        const text = textFor(change, { kind: postKind(w.kind), target: w.target });
        const rows = await db()
          .update(directPostSend)
          .set({ ...(change.sendAt ? { sendAt: change.sendAt, claimedUntil: null } : {}), ...(text !== undefined ? { text } : {}), revision: sql`${directPostSend.revision} + 1`, updatedAt: now })
          .where(and(mine(userId, postId), eq(directPostSend.kind, w.kind), eq(directPostSend.target, w.target), eq(directPostSend.status, "scheduled")))
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
          // Telegram and Discord: one row per post, so a new channel moves the row (the partial unique index).
          // Mastodon and Bluesky: one row per account, the primary key.
          ...(ONE_PER_POST.has(item.kind)
            ? { target: [directPostSend.postId, directPostSend.kind], targetWhere: sql`${directPostSend.kind} in ('telegram', 'discord')` }
            : { target: [directPostSend.postId, directPostSend.kind, directPostSend.target] }),
          set: { target: item.target, label: item.label, text: item.text, guildId: item.guildId ?? null, status: "scheduled", sendAt, revision: sql`${directPostSend.revision} + 1`, claimedUntil: null, callStartedAt: null, updatedAt: now },
          setWhere: sql`${directPostSend.userId} = ${userId} and ${directPostSend.status} in ('scheduled', 'cancelled')`,
        })
        .returning({ id: directPostSend.postId });
      return rows.length === 1;
    },
    async unfollow(userId, postId, place, now) {
      await db()
        .update(directPostSend)
        .set({ status: "cancelled", revision: sql`${directPostSend.revision} + 1`, updatedAt: now })
        .where(and(mine(userId, postId), at(place), eq(directPostSend.status, "scheduled")));
    },
    async defer(userId, postId, place, when, now) {
      // A held row keeps its time (the one-day limit counts from it) and is not due again before holdUntil.
      await db()
        .update(directPostSend)
        .set({ status: "scheduled", ...(when.sendAt ? { sendAt: when.sendAt } : {}), claimedUntil: when.holdUntil ?? null, updatedAt: now })
        .where(and(mine(userId, postId), at(place), eq(directPostSend.status, "pending"), sql`${directPostSend.callStartedAt} is null`));
    },
    async retryLater(userId, postId, place, until, now) {
      // Only after the network refused with "wait": nothing was posted, so the call mark is cleared. At the ceiling the
      // row is left pending for the caller to fail; a row no longer pending is not this run's, so that counts as done.
      const [row] = await db()
        .select({ status: directPostSend.status, waits: directPostSend.waits })
        .from(directPostSend)
        .where(and(mine(userId, postId), at(place)));
      if (!row || row.status !== "pending") return true;
      if (row.waits >= WAIT_CEILING) return false;
      await db()
        .update(directPostSend)
        .set({ status: "scheduled", sendAt: sql`coalesce(${directPostSend.sendAt}, ${until})`, claimedUntil: until, callStartedAt: null, waits: sql`${directPostSend.waits} + 1`, updatedAt: now })
        .where(and(mine(userId, postId), at(place), eq(directPostSend.status, "pending")));
      return true;
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
  };
}

/** Cancelling scheduled rows, one post or every post to a kind of place. */
function cancelling(): Cancelling {
  return {
    async cancelKind(userId, kind, now) {
      const rows = await db()
        .update(directPostSend)
        .set({ status: "cancelled", revision: sql`${directPostSend.revision} + 1`, updatedAt: now })
        // A claimed row whose call has not started is cancelled too: startCall then refuses it and the worker stops.
        .where(and(eq(directPostSend.userId, userId), eq(directPostSend.kind, kind), or(eq(directPostSend.status, "scheduled"), and(eq(directPostSend.status, "pending"), isNull(directPostSend.callStartedAt)))))
        .returning({ id: directPostSend.postId });
      return rows.length;
    },
    async cancel(userId, postId, now) {
      const rows = await db()
        .update(directPostSend)
        .set({ status: "cancelled", revision: sql`${directPostSend.revision} + 1`, updatedAt: now })
        .where(and(mine(userId, postId), eq(directPostSend.status, "scheduled")))
        .returning({ id: directPostSend.postId });
      return rows.length;
    },
  };
}

/** Claiming due rows, sending them, and reading them back. */
function sending(): Omit<DirectPostStore, keyof Planning | keyof Cancelling> {
  return {
    async claimDue(now, limit, only) {
      const t = directPostSend;
      // Rows that are due and not held, or claimed by a worker that died before calling. SKIP LOCKED lets any number
      // of workers run at once; each row goes to one of them.
      const due = db()
        .select({ postId: t.postId, kind: t.kind, target: t.target })
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
        .where(sql`(${t.postId}, ${t.kind}, ${t.target}) in ${due}`)
        .returning();
      return rows.map((r) => ({ ...toRow(r), userId: r.userId }));
    },
    async hold(userId, postId, place, until, now) {
      await db()
        .update(directPostSend)
        .set({ status: "scheduled", sendAt: sql`coalesce(${directPostSend.sendAt}, ${until})`, claimedUntil: until, updatedAt: now })
        .where(and(mine(userId, postId), at(place), eq(directPostSend.status, "pending"), isNull(directPostSend.callStartedAt)));
    },
    async release(userId, postId, place, now) {
      await db()
        .update(directPostSend)
        .set({ claimedUntil: new Date(now.getTime() - 1), updatedAt: now })
        .where(and(mine(userId, postId), at(place), eq(directPostSend.status, "pending"), isNull(directPostSend.callStartedAt)));
    },
    async startCall(userId, postId, place, now) {
      const rows = await db()
        .update(directPostSend)
        .set({ callStartedAt: now, updatedAt: now })
        .where(and(mine(userId, postId), at(place), eq(directPostSend.status, "pending"), sql`${directPostSend.callStartedAt} is null`))
        .returning({ id: directPostSend.postId });
      return rows.length === 1;
    },
    async rows(userId, postId) {
      return (await db().select().from(directPostSend).where(mine(userId, postId))).map(toRow);
    },
    async reclaimFailed(userId, postId, place, now) {
      // One statement: only a failed row of this user's flips back to pending, so two resends cannot both win.
      const [row] = await db()
        .update(directPostSend)
        .set({ status: "pending", attempts: sql`${directPostSend.attempts} + 1`, waits: 0, error: null, callStartedAt: null, claimedUntil: new Date(now.getTime() + CLAIM_MS), updatedAt: now })
        .where(and(mine(userId, postId), at(place), eq(directPostSend.status, "failed"), isNull(directPostSend.bufferPostId)))
        .returning();
      return row ? toRow(row) : null;
    },
    async finish(userId, postId, place, result, now) {
      await db()
        .update(directPostSend)
        .set({ status: result.status, link: result.link, error: result.error, updatedAt: now })
        .where(and(mine(userId, postId), at(place), eq(directPostSend.status, "pending")));
    },
    async recent(userId, limit) {
      return (await db().select().from(directPostSend).where(eq(directPostSend.userId, userId)).orderBy(desc(directPostSend.createdAt)).limit(limit)).map(toRow);
    },
    async between(userId, start, end) {
      const at = sql`coalesce(${directPostSend.sendAt}, ${directPostSend.createdAt})`;
      return (await db().select().from(directPostSend).where(and(
        eq(directPostSend.userId, userId), inArray(directPostSend.kind, [...SOCIAL_NETWORKS]), ne(directPostSend.status, "cancelled"),
        sql`${at} >= ${start}`, sql`${at} < ${end}`,
      )).orderBy(asc(at))).map(toRow);
    },
  };
}

export function postgresDirectPostStore(): DirectPostStore {
  return { ...planning(), ...cancelling(), ...sending() };
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
