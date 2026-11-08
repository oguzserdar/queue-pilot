/**
 * Announcement rows in Postgres. The (announcement, kind) primary key is the claim: inserting it is what lets exactly
 * one request send a destination, across tabs and server instances. Every statement is scoped to the user id.
 */
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { announcementSend } from "../db/schema";
import type { AnnounceRow, AnnounceStore } from "./announce";

const toRow = (r: typeof announcementSend.$inferSelect): AnnounceRow => ({
  announcementId: r.announcementId, kind: r.kind, target: r.target, label: r.label, text: r.text, status: r.status,
  attempts: r.attempts, link: r.link, error: r.error, createdAt: r.createdAt, updatedAt: r.updatedAt,
});

export function postgresAnnounceStore(): AnnounceStore {
  return {
    async claim(userId, announcementId, item, now) {
      const rows = await db()
        .insert(announcementSend)
        .values({ announcementId, userId, kind: item.kind, target: item.target, label: item.label, text: item.text, status: "pending", createdAt: now, updatedAt: now })
        .onConflictDoNothing()
        .returning({ id: announcementSend.announcementId });
      return rows.length === 1;
    },
    async reclaimFailed(userId, announcementId, kind, now) {
      // One statement: only a failed row of this user's flips back to pending, so two resends cannot both win.
      const [row] = await db()
        .update(announcementSend)
        .set({ status: "pending", attempts: sql`${announcementSend.attempts} + 1`, error: null, updatedAt: now })
        .where(and(eq(announcementSend.userId, userId), eq(announcementSend.announcementId, announcementId), eq(announcementSend.kind, kind), eq(announcementSend.status, "failed")))
        .returning();
      return row ? toRow(row) : null;
    },
    async finish(userId, announcementId, kind, result, now) {
      await db()
        .update(announcementSend)
        .set({ status: result.status, link: result.link, error: result.error, updatedAt: now })
        .where(and(eq(announcementSend.userId, userId), eq(announcementSend.announcementId, announcementId), eq(announcementSend.kind, kind)));
    },
    async recent(userId, limit) {
      return (await db().select().from(announcementSend).where(eq(announcementSend.userId, userId)).orderBy(desc(announcementSend.createdAt)).limit(limit)).map(toRow);
    },
  };
}
