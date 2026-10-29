import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Real Postgres (PGLite) with the real migrations, behind the app's Drizzle client.
const pg = new PGlite();
const testDb = drizzle(pg, { schema: { ...(await import("../db/schema")), ...(await import("../db/auth-schema")) } });
let broken = false;
vi.mock("../db", () => ({ db: () => (broken ? { insert: () => { throw new Error("database is down"); } } : testDb), schema: {} }));

const { bucketStart, limit, limitHeaders, pruneRequestCounts, RULES } = await import("./rate-limit");

beforeAll(async () => {
  await migrate(testDb, { migrationsFolder: join(__dirname, "../../drizzle"), migrationsTable: "__drizzle_migrations__", migrationsSchema: "public" });
});
afterAll(async () => { await pg.close(); });

const T = Date.parse("2026-11-02T10:00:05Z");

describe("request limits on real Postgres", () => {
  it("allows the rule's number of requests in a window, then refuses with the seconds left", async () => {
    const results = [];
    for (let i = 0; i < RULES.ai.max + 1; i++) results.push(await limit("ai", "user-1", T));
    expect(results.map((r) => r.ok)).toEqual([true, true, true, false]);
    expect(results[3]).toMatchObject({ remaining: 0, resetSeconds: 55, max: 3, windowSeconds: 60 });
  });

  it("starts a new window when the old one ends", async () => {
    expect((await limit("ai", "user-1", T + 60_000)).ok).toBe(true);
  });

  it("counts people, addresses and actions separately", async () => {
    expect((await limit("ai", "user-2", T)).ok).toBe(true);
    expect((await limit("bufferWrite", "user-1", T)).ok).toBe(true);
  });

  it("lets requests through when the database is down, rather than taking the product down", async () => {
    broken = true;
    const r = await limit("ai", "user-1", T);
    broken = false;
    expect(r.ok).toBe(true);
  });

  it("prunes windows older than a day", async () => {
    await limit("connect", "old", T - 2 * 86_400_000);
    await pruneRequestCounts(T);
    const rows = await pg.query("select count(*)::int as n from qp_request_count where key = 'old'");
    expect((rows.rows[0] as { n: number }).n).toBe(0);
  });
});

describe("headers", () => {
  it("sends the draft RateLimit fields always and Retry-After only on a refusal", () => {
    const ok = { ok: true, max: 3, windowSeconds: 60, remaining: 2, resetSeconds: 40 };
    expect(limitHeaders("ai", ok)).toEqual({ "RateLimit-Policy": '"ai";q=3;w=60', RateLimit: '"ai";r=2;t=40' });
    expect(limitHeaders("ai", { ...ok, ok: false, remaining: 0 })["Retry-After"]).toBe("40");
  });
  it("aligns windows to fixed boundaries", () => {
    expect(new Date(bucketStart(T, 60)).toISOString()).toBe("2026-11-02T10:00:00.000Z");
  });
});
