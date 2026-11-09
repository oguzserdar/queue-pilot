/**
 * @fileoverview The Buffer snapshot store on real Postgres (PGlite) with the real migrations, used through two store
 * objects as two server instances would: a read that started before a confirmed write cannot be saved over it, two
 * writes patched at the same moment both survive, and a read that started after the write saves normally.
 */
import { migratedPglite } from "@/test/migrated-pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Post } from "./queries";

const pg = await migratedPglite();
const testDb = drizzle(pg, { schema: { ...(await import("../../db/schema")), ...(await import("../../db/auth-schema")) } });
vi.mock("../../db", () => ({ db: () => testDb, schema: {} }));

const { postgresSnapshotStore } = await import("./snapshot-store");
const { withPosts } = await import("./snapshot");
type Snapshot = import("./snapshot").Snapshot;

beforeAll(async () => {
  await pg.query(`insert into "user" (id, name, email) values ('a', 'a', 'a@x')`);
});
afterAll(async () => { await pg.close(); });

const t0 = new Date("2026-11-05T10:00:00Z");
const at = (ms: number) => new Date(t0.getTime() + ms);
const post = (id: string): Post => ({ id, channelId: "c1", status: "draft", text: id, dueAt: "2026-11-11T15:00:00Z", sentAt: null, externalLink: null, error: null });
const copy = (ids: string[], fetchedAt: Date): Snapshot => ({ data: { email: "a@x", timezone: "UTC", organizationIds: ["o"], teamSizes: {}, channels: [], posts: ids.map(post), truncated: false, range: { start: "", end: "" } }, rateLimit: [], fetchedAt });
const ids = (s: Snapshot | null) => s?.data.posts.map((p) => p.id).sort();

describe("Buffer snapshot store on real Postgres", () => {
  it("keeps a confirmed write when a read that started before it is saved afterwards, from another instance", async () => {
    const writer = postgresSnapshotStore();
    const reader = postgresSnapshotStore();
    expect(await writer.save("a", copy(["p1"], t0))).toBe(true);
    // The other instance starts reading Buffer at t0+1s, before the write is confirmed.
    const staleRead = copy(["p1"], at(1_000));
    expect(await writer.patch("a", (s) => withPosts(s, [post("p2")]), at(2_000))).toBe(true);
    expect(await reader.save("a", staleRead)).toBe(false);
    expect(ids(await reader.get("a"))).toEqual(["p1", "p2"]);
    // A read that started after the write replaces the copy as usual.
    expect(await reader.save("a", copy(["p1", "p2", "p3"], at(3_000)))).toBe(true);
    expect(ids(await writer.get("a"))).toEqual(["p1", "p2", "p3"]);
  });

  it("keeps both of two writes patched at the same moment", async () => {
    const one = postgresSnapshotStore();
    const two = postgresSnapshotStore();
    await one.save("a", copy(["p1"], at(10_000)));
    await Promise.all([
      one.patch("a", (s) => withPosts(s, [post("x1")]), at(11_000)),
      two.patch("a", (s) => withPosts(s, [post("x2")]), at(11_000)),
    ]);
    expect(ids(await one.get("a"))).toEqual(["p1", "x1", "x2"]);
  });

  it("never moves the patch mark backwards, and rejects a read that started in the same instant as a write", async () => {
    const s = postgresSnapshotStore();
    await s.save("a", copy(["p1"], at(20_000)));
    // Two patches finish in reverse order of their times: the later time stays the mark.
    await s.patch("a", (x) => withPosts(x, [post("r2")]), at(22_000));
    await s.patch("a", (x) => withPosts(x, [post("r1")]), at(21_000));
    expect(await s.save("a", copy(["p1"], at(21_500)))).toBe(false);
    // Same instant as the latest write: may predate it, so it is not saved.
    expect(await s.save("a", copy(["p1"], at(22_000)))).toBe(false);
    expect(ids(await s.get("a"))).toEqual(["p1", "r1", "r2"]);
    expect(await s.save("a", copy(["p1", "r1", "r2", "p9"], at(22_001)))).toBe(true);
  });

  it("does nothing and says so when there is no copy yet", async () => {
    expect(await postgresSnapshotStore().patch("nobody", (s) => s, t0)).toBe(false);
  });
});
