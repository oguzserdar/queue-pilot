/**
 * Where each user's echo destinations (a Telegram channel, a Discord channel) and copy records live. A copy is one
 * row per (user, post, destination): the primary key is what makes "never send twice" hold across server instances.
 */
import { randomUUID } from "node:crypto";
import { and, eq, inArray, lt, ne, sql } from "drizzle-orm";
import { db } from "../db";
import { echo, echoClaim, echoDestination, telegramCode } from "../db/schema";
import type { Destination, EchoRecord } from "./echo";

/** A destination plus where to post: a Telegram chat id, or a Discord channel id inside a server. */
export type StoredDestination = Destination & { target: string; guildId: string | null; connectedAt: string };

export type EchoStore = {
  /** Users with at least one destination, for the scheduled run. */
  usersWithDestinations(): Promise<string[]>;
  destinations(userId: string): Promise<StoredDestination[]>;
  /** Adds or replaces the user's destination of this kind (one Telegram channel and one Discord channel each). */
  setDestination(userId: string, d: { kind: Destination["kind"]; label: string; target: string; guildId?: string | null }): Promise<StoredDestination>;
  removeDestination(userId: string, kind: Destination["kind"]): Promise<void>;
  records(userId: string, postIds: string[]): Promise<EchoRecord[]>;
  record(userId: string, r: EchoRecord): Promise<void>;
  /** Claims one copy until `until`; false when it already landed or another run's claim has not expired. */
  claim(userId: string, postId: string, destinationId: string, now: Date, until: Date): Promise<boolean>;
};

/** How long a claim holds; a run that crashed mid-send frees the copy for retry after this. */
export const CLAIM_MS = 10 * 60_000;

/** Same rules as Postgres, for tests. */
export function memoryEchoStore(now: () => Date = () => new Date()): EchoStore {
  const dests = new Map<string, StoredDestination[]>();
  const recs = new Map<string, EchoRecord>();
  const claims = new Map<string, number>();
  return {
    async usersWithDestinations() {
      return [...dests.entries()].filter(([, d]) => d.length > 0).map(([u]) => u).sort();
    },
    async destinations(userId) {
      return [...(dests.get(userId) ?? [])];
    },
    async setDestination(userId, d) {
      const next: StoredDestination = { id: randomUUID(), kind: d.kind, label: d.label, target: d.target, guildId: d.guildId ?? null, connectedAt: now().toISOString() };
      dests.set(userId, [...(dests.get(userId) ?? []).filter((x) => x.kind !== d.kind), next]);
      return next;
    },
    async removeDestination(userId, kind) {
      dests.set(userId, (dests.get(userId) ?? []).filter((x) => x.kind !== kind));
    },
    async records(userId, postIds) {
      const want = new Set(postIds);
      return [...recs.entries()].filter(([k, r]) => k.startsWith(`${userId}|`) && want.has(r.postId)).map(([, r]) => r);
    },
    async record(userId, r) {
      recs.set(`${userId}|${r.postId}|${r.destinationId}`, r);
    },
    async claim(userId, postId, destinationId, now, until) {
      const key = `${userId}|${postId}|${destinationId}`;
      if (recs.get(key)?.status === "sent") return false;
      if ((claims.get(key) ?? 0) > now.getTime()) return false;
      claims.set(key, until.getTime());
      return true;
    },
  };
}

type DestRow = typeof echoDestination.$inferSelect;
const toDest = (r: DestRow): StoredDestination => ({ id: r.id, kind: r.kind, label: r.label, target: r.target, guildId: r.guildId, connectedAt: r.connectedAt.toISOString() });

/** Destinations and copy records in Postgres through Drizzle. Every statement is scoped to the user id. */
export function postgresEchoStore(): EchoStore {
  return {
    async usersWithDestinations() {
      return (await db().selectDistinct({ u: echoDestination.userId }).from(echoDestination).orderBy(echoDestination.userId)).map((r) => r.u);
    },
    async destinations(userId) {
      return (await db().select().from(echoDestination).where(eq(echoDestination.userId, userId)).orderBy(echoDestination.kind)).map(toDest);
    },
    async setDestination(userId, d) {
      // Replacing a destination gives it a new id and connected time, so old posts are not copied to the new one.
      const [row] = await db()
        .insert(echoDestination)
        .values({ id: randomUUID(), userId, kind: d.kind, label: d.label, target: d.target, guildId: d.guildId ?? null })
        .onConflictDoUpdate({
          target: [echoDestination.userId, echoDestination.kind],
          set: { id: sql`excluded.id`, label: sql`excluded.label`, target: sql`excluded.target`, guildId: sql`excluded.guild_id`, connectedAt: sql`now()` },
        })
        .returning();
      return toDest(row);
    },
    async removeDestination(userId, kind) {
      await db().delete(echoDestination).where(and(eq(echoDestination.userId, userId), eq(echoDestination.kind, kind)));
    },
    async records(userId, postIds) {
      if (!postIds.length) return [];
      const rows = await db().select().from(echo).where(and(eq(echo.userId, userId), inArray(echo.postId, postIds)));
      return rows.map((r) => ({
        postId: r.postId, destinationId: r.destinationId, status: r.status, attempts: r.attempts,
        ...(r.messageId ? { messageId: r.messageId } : {}), ...(r.error ? { error: r.error } : {}),
      }));
    },
    async record(userId, r) {
      // A copy that already landed is never overwritten by a later failure.
      await db()
        .insert(echo)
        .values({ userId, postId: r.postId, destinationId: r.destinationId, status: r.status, attempts: r.attempts, messageId: r.messageId ?? null, error: r.error ?? null })
        .onConflictDoUpdate({
          target: [echo.userId, echo.postId, echo.destinationId],
          set: { status: sql`excluded.status`, attempts: sql`excluded.attempts`, messageId: sql`excluded.message_id`, error: sql`excluded.error`, updatedAt: sql`now()` },
          setWhere: ne(echo.status, "sent"),
        });
    },
    async claim(userId, postId, destinationId, now, until) {
      // One statement: take the claim only if the copy has not landed and no unexpired claim exists.
      const won = await db().execute(sql`
        insert into ${echoClaim} (user_id, post_id, destination_id, claimed_until)
        select ${userId}, ${postId}, ${destinationId}, ${until}
        where not exists (select 1 from ${echo} where user_id = ${userId} and post_id = ${postId} and destination_id = ${destinationId} and status = 'sent')
        on conflict (user_id, post_id, destination_id) do update set claimed_until = excluded.claimed_until
        where ${echoClaim}.claimed_until <= ${now}
        returning post_id`);
      return won.rows.length === 1;
    },
  };
}

/** Telegram connect codes seen in the bot's updates, kept so any user's check finds their own code. */
export type TelegramCodeStore = {
  save(codes: { code: string; chatId: number; title: string }[]): Promise<void>;
  find(code: string): Promise<{ chatId: number; title: string } | null>;
};

/**
 * Same rules as Postgres, for tests: the FIRST sighting of a code wins. The code exists only once the user posts it,
 * so the first chat to carry it is theirs; a copy replayed elsewhere later cannot take over.
 */
export function memoryTelegramCodes(): TelegramCodeStore {
  const codes = new Map<string, { chatId: number; title: string }>();
  return {
    async save(list) {
      for (const c of list) if (!codes.has(c.code)) codes.set(c.code, { chatId: c.chatId, title: c.title });
    },
    async find(code) {
      return codes.get(code) ?? null;
    },
  };
}

/** Codes in Postgres through Drizzle; a code is only useful for two days, so older rows are removed on each save. */
export function postgresTelegramCodes(): TelegramCodeStore {
  return {
    async save(list) {
      await db().delete(telegramCode).where(lt(telegramCode.seenAt, sql`now() - interval '2 days'`));
      // In order, first sighting wins: updates are read oldest first.
      for (const c of list) await db().insert(telegramCode).values({ code: c.code, chatId: String(c.chatId), title: c.title }).onConflictDoNothing();
    },
    async find(code) {
      const [row] = await db().select().from(telegramCode).where(eq(telegramCode.code, code));
      return row ? { chatId: Number(row.chatId), title: row.title } : null;
    },
  };
}
