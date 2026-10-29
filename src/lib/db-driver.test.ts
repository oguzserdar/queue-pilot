import { PGlite } from "@electric-sql/pglite";
import { afterAll, describe, expect, it, vi } from "vitest";

// The `pg` driver swapped for PGLite (real Postgres in memory), so the token lock runs its exact SQL.
const pg = new PGlite();
const pools: { options: Record<string, unknown>; connects: number }[] = [];
const sqlLog: string[] = [];
vi.mock("pg", () => {
  const run = async (text: string, values: unknown[] = []) => { sqlLog.push(text); return { rows: (await pg.query(text, values)).rows }; };
  class Pool {
    record: { options: Record<string, unknown>; connects: number };
    constructor(options: Record<string, unknown>) { this.record = { options, connects: 0 }; pools.push(this.record); }
    query = run;
    async connect() { this.record.connects++; return { query: run, release() {} }; }
  }
  return { Pool, default: { Pool } };
});
vi.stubEnv("DATABASE_URL", "postgres://pglite");
// The fake Pool above is not a real pg Pool, so Vercel's pool hook is stubbed here; the test below proves it accepts
// the real one.
vi.mock("@vercel/functions", () => ({ attachDatabasePool: () => {} }));

const { pgAdvisoryLock } = await import("./buffer-token");
const { dbPool } = await import("./db");

const heldLocks = async () => ((await pg.query("select count(*)::int as n from pg_locks where locktype = 'advisory'")).rows[0] as { n: number }).n;

afterAll(async () => { await pg.close(); });

describe("token refresh lock on real Postgres", () => {
  it("holds the lock while the work runs and returns its result", async () => {
    let during = -1;
    expect(await pgAdvisoryLock("buffer-token:u1", async () => { during = await heldLocks(); return "done"; })).toBe("done");
    expect(during).toBe(1);
    // The lock was released: no advisory locks are left held.
    const held = await pg.query("select count(*)::int as n from pg_locks where locktype = 'advisory'");
    expect((held.rows[0] as { n: number }).n).toBe(0);
  });

  it("releases the lock when the work throws (no lock left held)", async () => {
    await expect(pgAdvisoryLock("buffer-token:u2", async () => { throw new Error("refresh failed"); })).rejects.toThrow("refresh failed");
    const held = await pg.query("select count(*)::int as n from pg_locks where locktype = 'advisory'");
    expect((held.rows[0] as { n: number }).n).toBe(0);
  });

  it("takes a transaction-level lock, which Neon's pooled (transaction-mode) connections support", async () => {
    sqlLog.length = 0;
    await pgAdvisoryLock("buffer-token:u3", async () => "ok");
    expect(sqlLog).toEqual(["begin", "select pg_advisory_xact_lock(hashtext($1))", "commit"]);
    expect(sqlLog.join(" ")).not.toMatch(/pg_advisory_lock\(|pg_advisory_unlock/);
  });

  it("rolls back, and so releases, when the work throws", async () => {
    sqlLog.length = 0;
    await expect(pgAdvisoryLock("buffer-token:u4", async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    expect(sqlLog.at(-1)).toBe("rollback");
    expect(await heldLocks()).toBe(0);
  });

  it("holds the lock on its own pool, so the refresh inside can still get connections from the main pool", async () => {
    const main = dbPool() as unknown as { record: { connects: number } };
    const before = main.record.connects;
    await pgAdvisoryLock("buffer-token:u5", async () => "ok");
    expect(main.record.connects).toBe(before);
    const lockPool = pools.find((p) => p !== main.record && p.connects > 0);
    expect(lockPool).toBeDefined();
  });

  it("gives up waiting for a connection instead of queueing forever", () => {
    dbPool();
    for (const p of pools) expect(p.options.connectionTimeoutMillis).toBeGreaterThan(0);
  });
});
