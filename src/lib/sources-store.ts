/**
 * The feeds each user drafts from, and which feed items were already turned into posts, so the AI is never handed the
 * same release or article twice. Postgres in production; an in-memory store with the same rules in tests.
 */
import { randomUUID } from "node:crypto";
import { and, asc, count, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { source, sourceUsed } from "../db/schema";

export type Source = { id: string; url: string; title: string; addedAt: string };

export const MAX_SOURCES = 10;

export type SourceStore = {
  list(userId: string): Promise<Source[]>;
  /** Adds a feed; returns the existing one when the URL is already there. Throws past MAX_SOURCES. */
  add(userId: string, url: string, title: string): Promise<Source>;
  remove(userId: string, id: string): Promise<void>;
  usedKeys(userId: string): Promise<Set<string>>;
  markUsed(userId: string, keys: string[]): Promise<void>;
};

export class TooManySourcesError extends Error {
  constructor() {
    super(`Queue Pilot reads up to ${MAX_SOURCES} feeds. Remove one to add another.`);
  }
}

/** Same rules as Postgres, for tests. */
export function memorySourceStore(): SourceStore {
  const sources = new Map<string, Source[]>();
  const used = new Map<string, Set<string>>();
  return {
    async list(userId) {
      return [...(sources.get(userId) ?? [])];
    },
    async add(userId, url, title) {
      const mine = sources.get(userId) ?? [];
      const existing = mine.find((s) => s.url === url);
      if (existing) return existing;
      if (mine.length >= MAX_SOURCES) throw new TooManySourcesError();
      const s = { id: randomUUID(), url, title, addedAt: new Date().toISOString() };
      sources.set(userId, [...mine, s]);
      return s;
    },
    async remove(userId, id) {
      sources.set(userId, (sources.get(userId) ?? []).filter((s) => s.id !== id));
    },
    async usedKeys(userId) {
      return new Set(used.get(userId) ?? []);
    },
    async markUsed(userId, keys) {
      const set = used.get(userId) ?? new Set<string>();
      for (const k of keys) set.add(k);
      used.set(userId, set);
    },
  };
}

/** Sources and used items in Postgres through Drizzle. Every statement is scoped to the user id. */
export function postgresSourceStore(): SourceStore {
  const toSource = (r: typeof source.$inferSelect): Source => ({ id: r.id, url: r.url, title: r.title, addedAt: r.addedAt.toISOString() });
  return {
    async list(userId) {
      return (await db().select().from(source).where(eq(source.userId, userId)).orderBy(asc(source.addedAt))).map(toSource);
    },
    async add(userId, url, title) {
      const [existing] = await db().select().from(source).where(and(eq(source.userId, userId), eq(source.url, url)));
      if (existing) return toSource(existing);
      const [{ n }] = await db().select({ n: count() }).from(source).where(eq(source.userId, userId));
      if (n >= MAX_SOURCES) throw new TooManySourcesError();
      const [row] = await db()
        .insert(source)
        .values({ id: randomUUID(), userId, url, title })
        .onConflictDoUpdate({ target: [source.userId, source.url], set: { title: sql`${source.title}` } })
        .returning();
      return toSource(row);
    },
    async remove(userId, id) {
      await db().delete(source).where(and(eq(source.userId, userId), eq(source.id, id)));
    },
    async usedKeys(userId) {
      return new Set((await db().select({ k: sourceUsed.itemKey }).from(sourceUsed).where(eq(sourceUsed.userId, userId))).map((r) => r.k));
    },
    async markUsed(userId, keys) {
      if (!keys.length) return;
      await db().insert(sourceUsed).values([...new Set(keys)].map((itemKey) => ({ userId, itemKey }))).onConflictDoNothing();
    },
  };
}
