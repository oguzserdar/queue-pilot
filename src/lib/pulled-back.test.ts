/**
 * @fileoverview Telling a post the person took off the schedule in Buffer from a new draft, on the migrated database.
 */
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { migratedPglite } from "@/test/migrated-pglite";

const pg = await migratedPglite();
const testDb = drizzle(pg);
vi.mock("../db", () => ({ db: () => testDb }));
const { postgresPulledBackStore, pulledBackBetween } = await import("./pulled-back");

beforeAll(async () => { await pg.exec(`insert into "user" (id, name, email, email_verified, created_at, updated_at) values ('u1','A','a@x.test',true,now(),now()),('u2','B','b@x.test',true,now(),now())`); });
afterAll(async () => { await pg.close(); });

describe("pulledBackBetween", () => {
  it("marks a post that was scheduled and is now a draft", () => {
    expect(pulledBackBetween([{ id: "p1", status: "scheduled" }], [{ id: "p1", status: "draft" }]).mark).toEqual(["p1"]);
  });
  it("control: does not mark a draft that was never seen scheduled", () => {
    expect(pulledBackBetween([{ id: "p1", status: "draft" }], [{ id: "p1", status: "draft" }, { id: "p2", status: "draft" }]).mark).toEqual([]);
  });
  it("marks nothing from a first read", () => {
    expect(pulledBackBetween(null, [{ id: "p1", status: "draft" }]).mark).toEqual([]);
  });
  it("clears a post seen scheduled, sent or failed again, never one still a draft", () => {
    const { clear } = pulledBackBetween(null, [{ id: "a", status: "scheduled" }, { id: "b", status: "sent" }, { id: "c", status: "error" }, { id: "d", status: "draft" }]);
    expect(clear).toEqual(["a", "b", "c"]);
  });
});

describe("the stored marks", () => {
  const store = postgresPulledBackStore();
  it("keeps marks per person, survives a repeat, and clears them", async () => {
    await store.apply("u1", { mark: ["p1", "p2"], clear: [] });
    await store.apply("u1", { mark: ["p1"], clear: [] });
    await store.apply("u2", { mark: ["p1"], clear: [] });
    expect([...(await store.list("u1"))].sort()).toEqual(["p1", "p2"]);
    await store.apply("u1", { mark: [], clear: ["p2"] });
    expect([...(await store.list("u1"))]).toEqual(["p1"]);
    expect([...(await store.list("u2"))]).toEqual(["p1"]);
  });
});

describe("marking through the saved copy of Buffer", async () => {
  const { postgresSnapshotStore } = await import("./buffer/snapshot-store");
  const snapshots = postgresSnapshotStore();
  const marks = postgresPulledBackStore();
  const copy = (posts: { id: string; status: string }[], at: string) => ({ data: { posts, channels: [], organizationIds: [], truncated: false, range: { start: at, end: at } }, rateLimit: [], fetchedAt: new Date(at) }) as never;

  it("marks a post scheduled in one read and a draft in the next, and an approval patch clears it", async () => {
    expect(await snapshots.save("u2", copy([{ id: "s1", status: "scheduled" }, { id: "d1", status: "draft" }], "2026-11-15T10:00:00Z"))).toBe(true);
    expect(await snapshots.save("u2", copy([{ id: "s1", status: "draft" }, { id: "d1", status: "draft" }], "2026-11-15T10:05:00Z"))).toBe(true);
    expect((await marks.list("u2")).has("s1")).toBe(true);
    expect((await marks.list("u2")).has("d1")).toBe(false);
    await snapshots.patch("u2", (s) => ({ ...s, data: { ...s.data, posts: s.data.posts.map((p) => (p.id === "s1" ? { ...p, status: "scheduled" } : p)) } }), new Date("2026-11-15T10:06:00Z"));
    expect((await marks.list("u2")).has("s1")).toBe(false);
  });

  it("control: a read older than a confirmed write is not saved and marks nothing", async () => {
    await snapshots.save("u1", copy([{ id: "x1", status: "scheduled" }], "2026-11-15T11:00:00Z"));
    await snapshots.patch("u1", (s) => s, new Date("2026-11-15T11:10:00Z"));
    expect(await snapshots.save("u1", copy([{ id: "x1", status: "draft" }], "2026-11-15T11:05:00Z"))).toBe(false);
    expect((await marks.list("u1")).has("x1")).toBe(false);
  });
});

describe("approved posts that are drafts again (the live 1.0 signal, kept after an upgrade)", async () => {
  const { approvedThenDraft, pulledBackFor } = await import("./pulled-back");
  const written = [{ postId: "a", approvedBy: "queue-pilot" }, { postId: "b", approvedBy: null }, { postId: "c", approvedBy: "queue-pilot" }];
  it("counts a post Queue Pilot approved that Buffer shows as a draft", () => {
    expect(approvedThenDraft(written, [{ id: "a", status: "draft" }, { id: "b", status: "draft" }, { id: "c", status: "scheduled" }])).toEqual(["a"]);
  });
  it("adds it to the stored marks, with an empty table as after an upgrade from 1.0", async () => {
    const empty = { list: async () => new Set<string>(), apply: async () => {} };
    expect([...(await pulledBackFor("u9", written, [{ id: "a", status: "draft" }], empty))]).toEqual(["a"]);
  });
});
