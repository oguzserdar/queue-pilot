/**
 * @fileoverview Promotions of Buffer channel-less drafts that Queue Pilot started. One row per person and content item,
 * claimed before the promote request with the call's own token. A recovery after an unclear answer adopts posts only
 * when a row exists with the same versions, so another app's posts never become Queue Pilot's.
 *
 * Concurrency: a claim succeeds only when no other promotion of that item is pending, or the pending one has the same
 * versions (a retry), or it is older than STALE_MS. Age is only a recovery window, not proof the old request never
 * reached Buffer, so the caller always re-reads the item from Buffer before claiming. Only the claiming token may complete an
 * attempt, so an older, slower call can never mark a newer attempt recorded. recordedAt is set only once every draft
 * is recorded; until then a retry keeps repairing.
 */
import { createHash, randomUUID } from "node:crypto";
import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "../db";
import { promotionAttempt } from "../db/schema";

/**
 * After this long a pending attempt may be replaced by different versions. A recovery window, not proof the old request
 * never reached Buffer: the caller has just re-read the item and seen it is still a channel-less draft.
 */
export const STALE_MS = 10 * 60_000;

/** One started promotion. */
export type PromotionAttempt = { fingerprint: string; token: string; recordedAt: Date | null; startedAt: Date };

/** Stores promotions per person. */
export type PromotionAttemptStore = {
  /** Claims this item for these versions. Returns the claim's token, or null while a different promotion is pending. */
  claim(userId: string, contentItemId: string, fingerprint: string, now?: Date): Promise<string | null>;
  /** The attempt for this item, or null. */
  get(userId: string, contentItemId: string): Promise<PromotionAttempt | null>;
  /** Marks the attempt recorded, only while it is still this token's and not yet recorded. */
  markRecorded(userId: string, contentItemId: string, token: string): Promise<void>;
};

/** What one promoted version is: its account, text, slot time and the proof it carries. */
export type FingerprintVersion = { channelId: string; text: string; dueAt?: string; snapshotId?: string; evidence?: unknown[] };

/**
 * A stable fingerprint of the versions, order-independent and whitespace-insensitive in the text. It covers the slot
 * time, the source and the evidence too, so a retry cannot swap in different proof under the same attempt.
 *
 * @param versions - The versions sent to Buffer
 * @returns A sha256 hex digest
 */
export function promotionFingerprint(versions: FingerprintVersion[]): string {
  const norm = versions
    .map((v) => [v.channelId, v.text.replace(/\s+/g, " ").trim(), v.dueAt ?? null, v.snapshotId ?? null, v.evidence ?? null] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return createHash("sha256").update(JSON.stringify(norm)).digest("hex");
}

/** The Postgres store; every statement is scoped to the person. */
export function postgresPromotionAttempts(): PromotionAttemptStore {
  return {
    async claim(userId, contentItemId, fingerprint, now = new Date()) {
      const token = randomUUID();
      const stale = new Date(now.getTime() - STALE_MS);
      const won = await db().insert(promotionAttempt).values({ userId, contentItemId, fingerprint, token, startedAt: now })
        .onConflictDoUpdate({
          target: [promotionAttempt.userId, promotionAttempt.contentItemId],
          set: { fingerprint, token, startedAt: now, recordedAt: null },
          // Replace only a finished attempt, the same versions, or a pending attempt too old to still be running.
          setWhere: or(sql`${promotionAttempt.recordedAt} is not null`, eq(promotionAttempt.fingerprint, fingerprint), lt(promotionAttempt.startedAt, stale)),
        })
        .returning({ token: promotionAttempt.token });
      return won.length && won[0].token === token ? token : null;
    },
    async get(userId, contentItemId) {
      const [row] = await db().select().from(promotionAttempt).where(and(eq(promotionAttempt.userId, userId), eq(promotionAttempt.contentItemId, contentItemId))).limit(1);
      return row ? { fingerprint: row.fingerprint, token: row.token, recordedAt: row.recordedAt, startedAt: row.startedAt } : null;
    },
    async markRecorded(userId, contentItemId, token) {
      await db().update(promotionAttempt).set({ recordedAt: new Date() })
        .where(and(eq(promotionAttempt.userId, userId), eq(promotionAttempt.contentItemId, contentItemId), eq(promotionAttempt.token, token), isNull(promotionAttempt.recordedAt)));
    },
  };
}

/** An in-memory store with the same rules, for tests. */
export function memoryPromotionAttempts(): PromotionAttemptStore & { rows: Map<string, PromotionAttempt> } {
  const rows = new Map<string, PromotionAttempt>();
  const key = (u: string, c: string) => `${u}|${c}`;
  return {
    rows,
    async claim(u, c, fingerprint, now = new Date()) {
      const cur = rows.get(key(u, c));
      if (cur && !cur.recordedAt && cur.fingerprint !== fingerprint && cur.startedAt.getTime() >= now.getTime() - STALE_MS) return null;
      const token = randomUUID();
      rows.set(key(u, c), { fingerprint, token, recordedAt: null, startedAt: now });
      return token;
    },
    async get(u, c) { return rows.get(key(u, c)) ?? null; },
    async markRecorded(u, c, token) { const r = rows.get(key(u, c)); if (r && r.token === token && !r.recordedAt) r.recordedAt = new Date(); },
  };
}
