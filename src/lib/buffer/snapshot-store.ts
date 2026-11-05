/**
 * Postgres home for Buffer snapshots (see snapshot.ts). One row per user. The refresh claim is a single
 * conditional UPDATE, so two server instances can never both win it.
 */
import { and, eq, isNull, lt, lte, or, sql } from "drizzle-orm";
import { db } from "../../db";
import { bufferSnapshot } from "../../db/schema";
import type { Snapshot, SnapshotStore } from "./snapshot";

/** Snapshots stored in Postgres through Drizzle. */
export function postgresSnapshotStore(): SnapshotStore {
  return {
    async get(userId) {
      const [row] = await db().select().from(bufferSnapshot).where(eq(bufferSnapshot.userId, userId));
      if (!row?.data || !row.fetchedAt) return null;
      return { data: row.data as Snapshot["data"], rateLimit: row.rateLimit as Snapshot["rateLimit"], fetchedAt: row.fetchedAt };
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
      // Kept out when a confirmed write was patched in after this read started, on whichever server instance.
      const saved = await db()
        .insert(bufferSnapshot)
        .values({ userId, data: snapshot.data, rateLimit: snapshot.rateLimit, fetchedAt: snapshot.fetchedAt })
        .onConflictDoUpdate({
          target: bufferSnapshot.userId,
          set: { data: snapshot.data, rateLimit: snapshot.rateLimit, fetchedAt: snapshot.fetchedAt },
          // Strictly after: a read that started in the same instant as a write may predate it.
          setWhere: or(isNull(bufferSnapshot.patchedAt), lt(bufferSnapshot.patchedAt, snapshot.fetchedAt)),
        })
        .returning({ userId: bufferSnapshot.userId });
      return saved.length === 1;
    },
    async patch(userId, change, at) {
      // The row lock makes concurrent patches take turns, so none is lost.
      return db().transaction(async (tx) => {
        const [row] = await tx.select().from(bufferSnapshot).where(eq(bufferSnapshot.userId, userId)).for("update");
        if (!row?.data || !row.fetchedAt) return false;
        const next = change({ data: row.data as Snapshot["data"], rateLimit: row.rateLimit as Snapshot["rateLimit"], fetchedAt: row.fetchedAt });
        // The mark only moves forward, even when two patches arrive with their times in reverse order.
        await tx.update(bufferSnapshot).set({ data: next.data, patchedAt: sql`greatest(${bufferSnapshot.patchedAt}, ${at})` }).where(eq(bufferSnapshot.userId, userId));
        return true;
      });
    },
    async release(userId) {
      await db().update(bufferSnapshot).set({ refreshingUntil: null }).where(eq(bufferSnapshot.userId, userId));
    },
  };
}
