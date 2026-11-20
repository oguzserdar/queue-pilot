/**
 * Postgres home for Buffer snapshots (see snapshot.ts). One row per user. The refresh claim is a single
 * conditional UPDATE, so two server instances can never both win it.
 */
import { and, eq, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import { db } from "../../db";
import { bufferSnapshot, pulledBack } from "../../db/schema";
import { pulledBackBetween } from "../pulled-back";
import type { Snapshot, SnapshotStore } from "./snapshot";

type Tx = Parameters<Parameters<ReturnType<typeof db>["transaction"]>[0]>[0];
/** The posts in a stored copy, or null when the copy holds none (an empty row, or data from before posts were kept). */
const postsOf = (data: Snapshot["data"] | null | undefined) => (data && typeof data === "object" && Array.isArray(data.posts) ? data.posts : null);

/** Marks and clears pulled-back posts from two copies, inside the caller's transaction. */
async function applyPulledBack(tx: Tx, userId: string, before: { id: string; status: string }[] | null, after: { id: string; status: string }[]) {
  const { mark, clear } = pulledBackBetween(before, after);
  if (clear.length) await tx.delete(pulledBack).where(and(eq(pulledBack.userId, userId), inArray(pulledBack.postId, clear)));
  if (mark.length) await tx.insert(pulledBack).values(mark.map((postId) => ({ userId, postId }))).onConflictDoNothing();
}

/** Snapshots stored in Postgres through Drizzle. */
export function postgresSnapshotStore(): SnapshotStore {
  return {
    async get(userId) {
      const [row] = await db().select().from(bufferSnapshot).where(eq(bufferSnapshot.userId, userId));
      if (!row?.data || !row.fetchedAt) return null;
      return { data: row.data, rateLimit: row.rateLimit, fetchedAt: row.fetchedAt };
    },
    async claim(userId, now, until) {
      await db().insert(bufferSnapshot).values({ userId }).onConflictDoNothing();
      // One conditional UPDATE, so two server instances can never both win the claim.
      const won = await db()
        .update(bufferSnapshot)
        .set({ refreshingUntil: until })
        .where(and(eq(bufferSnapshot.userId, userId), or(isNull(bufferSnapshot.refreshingUntil), lte(bufferSnapshot.refreshingUntil, now))))
        .returning({ userId: bufferSnapshot.userId });
      return won.length === 1;
    },
    async save(userId, snapshot) {
      // One transaction: the earlier copy is read under a row lock, so posts the person took off the schedule in Buffer
      // (scheduled before, a draft now) are marked from exactly the copy this one replaces. See pulled-back.ts.
      return db().transaction(async (tx) => {
        const [before] = await tx.select({ data: bufferSnapshot.data }).from(bufferSnapshot).where(eq(bufferSnapshot.userId, userId)).for("update");
        // Kept out when a confirmed write was patched in after this read started, on whichever server instance.
        const saved = await tx
          .insert(bufferSnapshot)
          .values({ userId, data: snapshot.data, rateLimit: snapshot.rateLimit, fetchedAt: snapshot.fetchedAt })
          .onConflictDoUpdate({
            target: bufferSnapshot.userId,
            set: { data: snapshot.data, rateLimit: snapshot.rateLimit, fetchedAt: snapshot.fetchedAt },
            // Strictly after: a read that started in the same instant as a write may predate it.
            setWhere: or(isNull(bufferSnapshot.patchedAt), lt(bufferSnapshot.patchedAt, snapshot.fetchedAt)),
          })
          .returning({ userId: bufferSnapshot.userId });
        if (saved.length !== 1) return false;
        await applyPulledBack(tx, userId, postsOf(before?.data), snapshot.data.posts);
        return true;
      });
    },
    async patch(userId, change, at) {
      // The row lock makes concurrent patches take turns, so none is lost.
      return db().transaction(async (tx) => {
        const [row] = await tx.select().from(bufferSnapshot).where(eq(bufferSnapshot.userId, userId)).for("update");
        if (!row?.data || !row.fetchedAt) return false;
        const next = change({ data: row.data, rateLimit: row.rateLimit, fetchedAt: row.fetchedAt });
        // The mark only moves forward, even when two patches arrive with their times in reverse order.
        await tx.update(bufferSnapshot).set({ data: next.data, patchedAt: sql`greatest(${bufferSnapshot.patchedAt}, ${at})` }).where(eq(bufferSnapshot.userId, userId));
        await applyPulledBack(tx, userId, postsOf(row.data), next.data.posts);
        return true;
      });
    },
    async release(userId) {
      await db().update(bufferSnapshot).set({ refreshingUntil: null }).where(eq(bufferSnapshot.userId, userId));
    },
  };
}
