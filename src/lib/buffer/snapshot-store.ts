/**
 * Postgres home for Buffer snapshots (see snapshot.ts). One row per user. The refresh claim is a single
 * conditional UPDATE, so two server instances can never both win it.
 */
import { and, eq, isNull, lte, or } from "drizzle-orm";
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
      await db()
        .insert(bufferSnapshot)
        .values({ userId, data: snapshot.data, rateLimit: snapshot.rateLimit, fetchedAt: snapshot.fetchedAt })
        .onConflictDoUpdate({ target: bufferSnapshot.userId, set: { data: snapshot.data, rateLimit: snapshot.rateLimit, fetchedAt: snapshot.fetchedAt } });
    },
    async release(userId) {
      await db().update(bufferSnapshot).set({ refreshingUntil: null }).where(eq(bufferSnapshot.userId, userId));
    },
  };
}
