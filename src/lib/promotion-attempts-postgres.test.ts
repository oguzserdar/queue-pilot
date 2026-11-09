/**
 * @fileoverview The promotion-attempt store on real Postgres (PGlite) with the real migrations: the claim's ON CONFLICT
 * ... setWhere ... RETURNING decides who wins, completion is conditioned on the token, and people never share rows.
 */
import { migratedPglite } from "@/test/migrated-pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const pg = await migratedPglite();
const testDb = drizzle(pg, { schema: { ...(await import("../db/schema")), ...(await import("../db/auth-schema")) } });
vi.mock("../db", () => ({ db: () => testDb, schema: {} }));

const { postgresPromotionAttempts, STALE_MS } = await import("./promotion-attempts");

beforeAll(async () => {
  await pg.query(`insert into "user" (id, name, email) values ('a', 'a', 'a@x'), ('b', 'b', 'b@x')`);
});
afterAll(async () => { await pg.close(); });

describe("promotion attempts on real Postgres", () => {
  const t0 = new Date("2026-11-05T09:00:00Z");
  const later = (ms: number) => new Date(t0.getTime() + ms);

  it("lets only one of two overlapping claims with different versions win, and another person is independent", async () => {
    const s = postgresPromotionAttempts();
    const first = await s.claim("a", "ci-1", "f1", t0);
    expect(first).toBeTruthy();
    expect(await s.claim("a", "ci-1", "f2", later(1000))).toBeNull();
    expect(await s.get("a", "ci-1")).toMatchObject({ fingerprint: "f1", token: first, recordedAt: null });
    const theirs = await s.claim("b", "ci-1", "f2", later(1000));
    expect(theirs).toBeTruthy();
    expect((await s.get("b", "ci-1"))?.fingerprint).toBe("f2");
    expect((await s.get("a", "ci-1"))?.fingerprint).toBe("f1");
  });

  it("re-claims the same versions with a new token, and a late older call cannot complete the newer attempt", async () => {
    const s = postgresPromotionAttempts();
    const old = (await s.claim("a", "ci-2", "f1", t0))!;
    const newer = (await s.claim("a", "ci-2", "f1", later(2000)))!;
    expect(newer).not.toBe(old);
    await s.markRecorded("a", "ci-2", old);
    expect((await s.get("a", "ci-2"))?.recordedAt).toBeNull();
    await s.markRecorded("a", "ci-2", newer);
    expect((await s.get("a", "ci-2"))?.recordedAt).toBeInstanceOf(Date);
  });

  it("lets different versions replace a pending attempt only after the recovery window, or once it is recorded", async () => {
    const s = postgresPromotionAttempts();
    expect(await s.claim("a", "ci-3", "f1", t0)).toBeTruthy();
    expect(await s.claim("a", "ci-3", "f2", later(STALE_MS - 1000))).toBeNull();
    expect(await s.claim("a", "ci-3", "f2", later(STALE_MS + 1000))).toBeTruthy();
    const tok = (await s.get("a", "ci-3"))!.token;
    await s.markRecorded("a", "ci-3", tok);
    expect(await s.claim("a", "ci-3", "f3", later(STALE_MS + 2000))).toBeTruthy();
    expect(await s.get("a", "ci-3")).toMatchObject({ fingerprint: "f3", recordedAt: null });
  });
});
