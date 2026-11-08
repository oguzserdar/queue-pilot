/**
 * @fileoverview The Postgres post store on PGlite with the real migrations: the primary key claim lets one
 * request send a destination, a resend wins once, and users stay apart.
 */
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const pg = new PGlite();
const testDb = drizzle(pg, { schema: { ...(await import("../db/schema")), ...(await import("../db/auth-schema")) } });
vi.mock("../db", () => ({ db: () => testDb }));
const { postgresDirectPostStore } = await import("./direct-post-store");

const item = { kind: "discord" as const, target: "c1", label: "#announcements", text: "Patch 1.4 is out." };
const now = new Date("2026-11-08T10:00:00Z");

beforeAll(async () => {
  await migrate(testDb, { migrationsFolder: join(__dirname, "../../drizzle"), migrationsTable: "__drizzle_migrations__", migrationsSchema: "public" });
  await pg.query(`insert into "user" (id, name, email) values ('u1', 'a', 'a@x'), ('u2', 'b', 'b@x')`);
});
afterAll(async () => { await pg.close(); });

describe("postgres post store", () => {
  it("lets exactly one of two simultaneous claims send a destination", async () => {
    const s = postgresDirectPostStore();
    const won = await Promise.all([s.claim("u1", "a1", item, now), s.claim("u1", "a1", item, now)]);
    expect(won.filter(Boolean)).toHaveLength(1);
  });

  it("resends a failed destination once, and never a sent one", async () => {
    const s = postgresDirectPostStore();
    await s.claim("u1", "a2", item, now);
    await s.finish("u1", "a2", "discord", { status: "failed", link: null, error: "Missing Permissions" }, now);
    const [a, b] = await Promise.all([s.reclaimFailed("u1", "a2", "discord", now), s.reclaimFailed("u1", "a2", "discord", now)]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
    expect(a?.attempts ?? b?.attempts).toBe(2);
    await s.finish("u1", "a2", "discord", { status: "sent", link: "https://discord.com/channels/g/c1/m", error: null }, now);
    expect(await s.reclaimFailed("u1", "a2", "discord", now)).toBeNull();
  });

  it("returns only this person's rows for an post", async () => {
    const s = postgresDirectPostStore();
    expect((await s.rows("u1", "a2")).map((r) => r.status)).toEqual(["sent"]);
    expect(await s.rows("u2", "a2")).toEqual([]);
  });

  it("keeps each person's posts to themselves", async () => {
    const s = postgresDirectPostStore();
    expect(await s.recent("u2", 10)).toEqual([]);
    await s.finish("u2", "a1", "discord", { status: "failed", link: null, error: "x" }, now);
    expect(await s.reclaimFailed("u2", "a1", "discord", now)).toBeNull();
    expect((await s.recent("u1", 10)).map((r) => r.postId).sort()).toEqual(["a1", "a2"]);
  });
});

describe("postgres due claims", () => {
  const at = new Date("2026-11-08T18:00:00Z");
  const after = new Date("2026-11-08T18:00:05Z");
  const tg = { kind: "telegram" as const, target: "-100", label: "Pennyrow news", text: "Ships at 18:00." };

  it("gives each due row to one of several workers claiming at once", async () => {
    const s = postgresDirectPostStore();
    for (const id of ["d1", "d2", "d3", "d4"]) await s.schedule("u1", id, item, at, now);
    const got = await Promise.all([s.claimDue(after, 10), s.claimDue(after, 10), s.claimDue(after, 10)]);
    const ids = got.flat().map((r) => r.postId).filter((id) => id.startsWith("d")).sort();
    expect(ids).toEqual(["d1", "d2", "d3", "d4"]);
  });

  it("claims nothing before its time, nothing cancelled, and only the current revision when asked", async () => {
    const s = postgresDirectPostStore();
    await s.schedule("u1", "e1", tg, at, now);
    expect(await s.claimDue(now, 10)).toEqual([]);
    await s.schedule("u1", "e2", tg, at, now);
    expect(await s.cancel("u1", "e2", now)).toBe(1);
    const [row] = await s.reschedule("u1", "e1", { texts: { telegram: "Edited." } }, now);
    expect(row.revision).toBe(1);
    expect(await s.claimDue(after, 10, { postId: "e1", revision: 0 })).toEqual([]);
    const got = await s.claimDue(after, 10, { postId: "e1", revision: 1 });
    expect(got.map((r) => [r.postId, r.text])).toEqual([["e1", "Edited."]]);
  });

  it("takes back a claim that never reached the call, and never one that did", async () => {
    const s = postgresDirectPostStore();
    await s.schedule("u1", "f1", tg, at, now);
    await s.schedule("u1", "f2", tg, at, now);
    await s.claimDue(after, 10); // both claimed; the worker dies
    expect(await s.startCall("u1", "f2", "telegram", after)).toBe(true); // f2 reached the call
    const later = new Date(after.getTime() + 3 * 60_000);
    const again = await s.claimDue(later, 10);
    expect(again.map((r) => r.postId).filter((id) => id.startsWith("f"))).toEqual(["f1"]);
  });

  it("never claims a pending row written by the previous version", async () => {
    await pg.query(`insert into qp_announcement_send (announcement_id, user_id, kind, target, label, text, status, created_at, updated_at) values ('old1', 'u1', 'telegram', '-100', 'x', 'y', 'pending', '2026-11-08T09:00:00Z', '2026-11-08T09:00:00Z')`);
    const s = postgresDirectPostStore();
    expect((await s.claimDue(new Date("2026-11-09T00:00:00Z"), 50)).map((r) => r.postId)).not.toContain("old1");
    const [row] = await s.rows("u1", "old1");
    expect(row.claimedUntil).toBeNull();
  });
});

