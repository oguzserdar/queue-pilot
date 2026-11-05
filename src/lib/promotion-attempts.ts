/**
 * @fileoverview Promotions of Buffer channel-less drafts that Queue Pilot started. One row per person and content item,
 * written before the promote request. A recovery after an unclear answer adopts posts only when this row exists with
 * the same versions, so another app's posts never become Queue Pilot's; recordedAt makes the recovery run once.
 */
import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { promotionAttempt } from "../db/schema";

/** One started promotion. */
export type PromotionAttempt = { fingerprint: string; recordedAt: Date | null };

/** Stores promotions per person. */
export type PromotionAttemptStore = {
  /** Records that this promotion is about to be sent; replaces an earlier attempt that was never recorded. */
  start(userId: string, contentItemId: string, fingerprint: string): Promise<void>;
  /** The attempt for this item, or null. */
  get(userId: string, contentItemId: string): Promise<PromotionAttempt | null>;
  /** Marks the attempt's drafts as recorded, so a later recovery records nothing again. */
  markRecorded(userId: string, contentItemId: string): Promise<void>;
};

/**
 * A stable fingerprint of the versions: account and whitespace-normalized text, order-independent.
 *
 * @param versions - The versions sent to Buffer
 * @returns A sha256 hex digest
 */
export function promotionFingerprint(versions: { channelId: string; text: string }[]): string {
  const norm = versions.map((v) => [v.channelId, v.text.replace(/\s+/g, " ").trim()]).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return createHash("sha256").update(JSON.stringify(norm)).digest("hex");
}

/** The Postgres store; every statement is scoped to the person. */
export function postgresPromotionAttempts(): PromotionAttemptStore {
  return {
    async start(userId, contentItemId, fingerprint) {
      await db().insert(promotionAttempt).values({ userId, contentItemId, fingerprint })
        .onConflictDoUpdate({ target: [promotionAttempt.userId, promotionAttempt.contentItemId], set: { fingerprint, startedAt: new Date(), recordedAt: null } });
    },
    async get(userId, contentItemId) {
      const [row] = await db().select().from(promotionAttempt).where(and(eq(promotionAttempt.userId, userId), eq(promotionAttempt.contentItemId, contentItemId))).limit(1);
      return row ? { fingerprint: row.fingerprint, recordedAt: row.recordedAt } : null;
    },
    async markRecorded(userId, contentItemId) {
      await db().update(promotionAttempt).set({ recordedAt: new Date() }).where(and(eq(promotionAttempt.userId, userId), eq(promotionAttempt.contentItemId, contentItemId)));
    },
  };
}

/** An in-memory store for tests. */
export function memoryPromotionAttempts(): PromotionAttemptStore & { rows: Map<string, PromotionAttempt> } {
  const rows = new Map<string, PromotionAttempt>();
  const key = (u: string, c: string) => `${u}|${c}`;
  return {
    rows,
    async start(u, c, fingerprint) { rows.set(key(u, c), { fingerprint, recordedAt: null }); },
    async get(u, c) { return rows.get(key(u, c)) ?? null; },
    async markRecorded(u, c) { const r = rows.get(key(u, c)); if (r) r.recordedAt = new Date(); },
  };
}
