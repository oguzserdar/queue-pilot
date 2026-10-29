/**
 * Postgres access through one shared `pg` Pool per server instance (Neon through Vercel provides DATABASE_URL).
 * Drizzle (src/db) and Better Auth's Drizzle adapter run on this pool; tables come from the migrations in /drizzle.
 */
import { Pool } from "pg";
import { attachDatabasePool } from "@vercel/functions";
import { desc, eq, sql } from "drizzle-orm";
import { operatorSettings, settingsAudit } from "../db/schema";
import { isSecret, type SettingKey, type SettingsStore } from "./settings";

let pool: Pool | null = null;
let lockPool: Pool | null = null;

/** How long a query waits for a free connection before failing; pg-pool otherwise queues forever. */
const CONNECTION_TIMEOUT_MS = 10_000;

function newPool(max: number): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  const created = new Pool({ connectionString, max, idleTimeoutMillis: 20_000, connectionTimeoutMillis: CONNECTION_TIMEOUT_MS });
  // Vercel Fluid compute suspends functions between requests; this releases idle clients before that, so
  // connections are not leaked (vercel.com/docs/functions/functions-api-reference/vercel-functions-package).
  attachDatabasePool(created);
  return created;
}

/** The shared pool. Serverless functions are short-lived, so it stays small and closes idle connections quickly. */
export function dbPool(): Pool {
  pool ??= newPool(3);
  return pool;
}

/**
 * Connections that only hold locks. A lock is held while the work inside it runs queries on dbPool, so sharing one
 * pool would let a few concurrent locks take every connection and wait forever for one more.
 */
export function dbLockPool(): Pool {
  lockPool ??= newPool(3);
  return lockPool;
}

/** Whether a database is configured for this deployment. */
export function hasDatabase(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

/** How long a server trusts its loaded settings before checking whether they changed. */
export const SETTINGS_TTL_MS = 30_000;

/** This server's copy of every operator setting, and the change number it was loaded at. */
type SettingsSnapshot = { version: number; checkedAt: number; values: Map<string, string> };
let settingsCache: Promise<SettingsSnapshot> | null = null;

/** The newest audit row's id: every settings write adds one in the same transaction, so it changes on every write. */
async function settingsVersion(): Promise<number> {
  const { db } = await import("../db");
  const [row] = await db().select({ v: sql<number>`coalesce(max(${settingsAudit.id}), 0)::int` }).from(settingsAudit);
  return row?.v ?? 0;
}

async function loadSettings(): Promise<SettingsSnapshot> {
  const { db } = await import("../db");
  const [version, rows] = await Promise.all([settingsVersion(), db().select().from(operatorSettings)]);
  return { version, checkedAt: Date.now(), values: new Map(rows.map((r) => [r.key, r.value])) };
}

/**
 * Every operator setting, read from this server's copy. The copy is loaded in one query; after SETTINGS_TTL_MS one
 * cheap version check decides whether to reload, so a change saved on another server applies within that time.
 * Concurrent callers share one load, and a failed load is not kept.
 */
async function cachedSettings(now: number = Date.now()): Promise<SettingsSnapshot> {
  const current = settingsCache;
  if (current) {
    const snap = await current.catch(() => null);
    if (snap && now - snap.checkedAt < SETTINGS_TTL_MS) return snap;
    if (snap && settingsCache === current) {
      const fresh = (async () => ((await settingsVersion()) === snap.version ? { ...snap, checkedAt: Date.now() } : loadSettings()))();
      settingsCache = fresh;
      fresh.catch(() => { if (settingsCache === fresh) settingsCache = null; });
      return fresh;
    }
    if (settingsCache !== current && settingsCache) return settingsCache;
  }
  const loading = loadSettings();
  settingsCache = loading;
  loading.catch(() => { if (settingsCache === loading) settingsCache = null; });
  return loading;
}

/** Forgets this server's copy, so the next read loads fresh values. */
export function forgetSettings(): void {
  settingsCache = null;
}

/**
 * Operator settings stored in Postgres through Drizzle. Secret values arrive here already encrypted. Every change is
 * written to qp_settings_audit in the same transaction; secret values are never written there.
 */
export function postgresSettingsStore(): SettingsStore {
  const shown = (key: SettingKey, v: string | null) => (isSecret(key) ? null : v);
  return {
    async get(key: SettingKey) {
      return (await cachedSettings()).values.get(key) ?? null;
    },
    async set(key: SettingKey, stored: string) {
      const { db } = await import("../db");
      await db().transaction(async (tx) => {
        const [old] = await tx.select().from(operatorSettings).where(eq(operatorSettings.key, key));
        await tx.insert(operatorSettings).values({ key, value: stored }).onConflictDoUpdate({ target: operatorSettings.key, set: { value: stored, updatedAt: sql`now()` } });
        await tx.insert(settingsAudit).values({ key, action: "set", fromValue: shown(key, old?.value ?? null), toValue: shown(key, stored) });
      });
      forgetSettings();
    },
    async remove(key: SettingKey) {
      const { db } = await import("../db");
      await db().transaction(async (tx) => {
        const [old] = await tx.delete(operatorSettings).where(eq(operatorSettings.key, key)).returning();
        if (old) await tx.insert(settingsAudit).values({ key, action: "cleared", fromValue: shown(key, old.value), toValue: null });
      });
      forgetSettings();
    },
  };
}

/** The latest changes to operator settings, newest first, for /admin. */
export async function recentSettingChanges(limit = 20) {
  const { db } = await import("../db");
  return db().select().from(settingsAudit).orderBy(desc(settingsAudit.id)).limit(limit);
}
