/**
 * @fileoverview The Postgres announcement store on PGlite with the real migrations: the primary key claim lets one
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
const { postgresAnnounceStore } = await import("./announce-store");

const item = { kind: "discord" as const, target: "c1", label: "#announcements", text: "Patch 1.4 is out." };
const now = new Date("2026-11-08T10:00:00Z");

beforeAll(async () => {
  await migrate(testDb, { migrationsFolder: join(__dirname, "../../drizzle"), migrationsTable: "__drizzle_migrations__", migrationsSchema: "public" });
  await pg.query(`insert into "user" (id, name, email) values ('u1', 'a', 'a@x'), ('u2', 'b', 'b@x')`);
});
afterAll(async () => { await pg.close(); });

describe("postgres announcement store", () => {
  it("lets exactly one of two simultaneous claims send a destination", async () => {
    const s = postgresAnnounceStore();
    const won = await Promise.all([s.claim("u1", "a1", item, now), s.claim("u1", "a1", item, now)]);
    expect(won.filter(Boolean)).toHaveLength(1);
  });

  it("resends a failed destination once, and never a sent one", async () => {
    const s = postgresAnnounceStore();
    await s.claim("u1", "a2", item, now);
    await s.finish("u1", "a2", "discord", { status: "failed", link: null, error: "Missing Permissions" }, now);
    const [a, b] = await Promise.all([s.reclaimFailed("u1", "a2", "discord", now), s.reclaimFailed("u1", "a2", "discord", now)]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
    expect(a?.attempts ?? b?.attempts).toBe(2);
    await s.finish("u1", "a2", "discord", { status: "sent", link: "https://discord.com/channels/g/c1/m", error: null }, now);
    expect(await s.reclaimFailed("u1", "a2", "discord", now)).toBeNull();
  });

  it("returns only this person's rows for an announcement", async () => {
    const s = postgresAnnounceStore();
    expect((await s.rows("u1", "a2")).map((r) => r.status)).toEqual(["sent"]);
    expect(await s.rows("u2", "a2")).toEqual([]);
  });

  it("keeps each person's announcements to themselves", async () => {
    const s = postgresAnnounceStore();
    expect(await s.recent("u2", 10)).toEqual([]);
    await s.finish("u2", "a1", "discord", { status: "failed", link: null, error: "x" }, now);
    expect(await s.reclaimFailed("u2", "a1", "discord", now)).toBeNull();
    expect((await s.recent("u1", 10)).map((r) => r.announcementId).sort()).toEqual(["a1", "a2"]);
  });
});
