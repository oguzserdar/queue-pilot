/**
 * @fileoverview One destination per connected account: a post can go to two Mastodon accounts, and each row is
 * finished, retried and resent on its own. Telegram and Discord keep one row per post, so changing a follow-up's
 * Discord channel moves it instead of adding a second channel. Run on the memory store and on Postgres (PGlite with
 * the real migrations).
 */
import { migratedPglite } from "@/test/migrated-pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { DirectPostStore, PostItem } from "./direct-posts";

const pg = await migratedPglite();
const testDb = drizzle(pg, { schema: { ...(await import("../db/schema")), ...(await import("../db/auth-schema")) } });
vi.mock("../db", () => ({ db: () => testDb }));
const { postgresDirectPostStore } = await import("./direct-post-store");
const { memoryDirectPostStore } = await import("./direct-posts");

const now = new Date("2026-11-15T10:00:00Z");
const later = new Date("2026-11-16T10:00:00Z");
const mastodon = (target: string): PostItem => ({ kind: "mastodon", target, label: `@${target}`, text: "Out now." });
const discord = (target: string): PostItem => ({ kind: "discord", target, label: `#${target}`, text: "Out now.", guildId: "g1" });

beforeAll(async () => { await pg.query(`insert into "user" (id, name, email) values ('u1', 'a', 'a@x')`); });
afterAll(async () => { await pg.close(); });

describe.each([
  ["memory", () => memoryDirectPostStore()],
  ["postgres", () => postgresDirectPostStore()],
] as [string, () => DirectPostStore][])("%s store, places per account", (name, make) => {
  const id = (s: string) => `${name}-${s}`;

  it("claims one post for two Mastodon accounts, and finishes each on its own", async () => {
    const s = make();
    expect(await s.claim("u1", id("p1"), mastodon("m1"), now)).toBe(true);
    expect(await s.claim("u1", id("p1"), mastodon("m2"), now)).toBe(true);
    expect(await s.startCall("u1", id("p1"), { kind: "mastodon", target: "m1" }, now)).toBe(true);
    await s.finish("u1", id("p1"), { kind: "mastodon", target: "m1" }, { status: "sent", link: "https://m/1", error: null }, now);
    const rows = await s.rows("u1", id("p1"));
    expect(rows.map((r) => `${r.target}:${r.status}`).sort()).toEqual(["m1:sent", "m2:pending"]);
  });

  it("resends only the failed account", async () => {
    const s = make();
    await s.claim("u1", id("p2"), mastodon("m1"), now);
    await s.claim("u1", id("p2"), mastodon("m2"), now);
    await s.finish("u1", id("p2"), { kind: "mastodon", target: "m1" }, { status: "failed", link: null, error: "refused" }, now);
    await s.finish("u1", id("p2"), { kind: "mastodon", target: "m2" }, { status: "sent", link: "https://m/2", error: null }, now);
    expect((await s.reclaimFailed("u1", id("p2"), { kind: "mastodon", target: "m2" }, now))).toBeNull();
    expect((await s.reclaimFailed("u1", id("p2"), { kind: "mastodon", target: "m1" }, now))?.target).toBe("m1");
  });

  it("control: the same account twice in one post is still one row", async () => {
    const s = make();
    expect(await s.claim("u1", id("p3"), mastodon("m1"), now)).toBe(true);
    expect(await s.claim("u1", id("p3"), mastodon("m1"), now)).toBe(false);
  });

  it("keeps Discord to one row per post: a second channel is refused", async () => {
    const s = make();
    expect(await s.claim("u1", id("p4"), discord("c1"), now)).toBe(true);
    expect(await s.claim("u1", id("p4"), discord("c2"), now)).toBe(false);
  });

  it("moves a follow-up's Discord channel instead of adding one", async () => {
    const s = make();
    await s.follow("u1", id("p5"), discord("c1"), later, now, "bp1");
    await s.follow("u1", id("p5"), discord("c2"), later, now, "bp1");
    expect((await s.rows("u1", id("p5"))).map((r) => r.target)).toEqual(["c2"]);
  });
});

describe.each([
  ["memory", () => memoryDirectPostStore()],
  ["postgres", () => postgresDirectPostStore()],
] as [string, () => DirectPostStore][])("%s store, wait ceiling", (name, make) => {
  it("allows 5 waits in a row, refuses the 6th, and a resend starts the count again", async () => {
    const s = make();
    const id = `${name}-w1`, place = { kind: "mastodon" as const, target: "m1" };
    await s.claim("u1", id, mastodon("m1"), now);
    const answers: boolean[] = [];
    let t = now.getTime();
    for (let i = 0; i < 6; i++) {
      answers.push(await s.retryLater("u1", id, place, new Date(t + 1_000), new Date(t)));
      t += 60_000;
      await s.claimDue(new Date(t), 10, { postId: id, revision: 99 });
    }
    expect(answers).toEqual([true, true, true, true, true, false]);
    await s.finish("u1", id, place, { status: "failed", link: null, error: "waited" }, new Date(t));
    expect((await s.reclaimFailed("u1", id, place, new Date(t)))?.waits).toBe(0);
    expect(await s.retryLater("u1", id, place, new Date(t + 1_000), new Date(t))).toBe(true);
  });
});

describe.each([
  ["memory", () => memoryDirectPostStore()],
  ["postgres", () => postgresDirectPostStore()],
] as [string, () => DirectPostStore][])("%s store, giving a claim back", (name, make) => {
  it("lets the next run take a released row at once, but never one whose call started", async () => {
    const s = make();
    const free = { kind: "mastodon" as const, target: "m1" }, busy = { kind: "mastodon" as const, target: "m2" };
    await s.claim("u1", `${name}-r1`, mastodon("m1"), now);
    await s.claim("u1", `${name}-r1`, mastodon("m2"), now);
    expect(await s.startCall("u1", `${name}-r1`, busy, now)).toBe(true);
    await s.release("u1", `${name}-r1`, free, now);
    await s.release("u1", `${name}-r1`, busy, now);
    const again = await s.claimDue(new Date(now.getTime() + 1_000), 10, { postId: `${name}-r1`, revision: 99 });
    expect(again.map((r) => r.target)).toEqual(["m1"]);
  });
});

describe.each([
  ["memory", () => memoryDirectPostStore()],
  ["postgres", () => postgresDirectPostStore()],
] as [string, () => DirectPostStore][])("%s store, changing a scheduled post per account", (name, make) => {
  it("gives each Mastodon account its own new text, and a kind-wide text still reaches the rest", async () => {
    const s = make();
    const id = `${name}-t1`;
    for (const t of ["m1", "m2", "m3"]) await s.schedule("u1", id, mastodon(t), later, now);
    await s.reschedule("u1", id, { texts: { "mastodon|m1": "For one.", "mastodon|m2": "For two.", mastodon: "For the rest." } }, now);
    const texts = Object.fromEntries((await s.rows("u1", id)).map((r) => [r.target, r.text]));
    expect(texts).toEqual({ m1: "For one.", m2: "For two.", m3: "For the rest." });
  });
});

describe.each([
  ["memory", () => memoryDirectPostStore()],
  ["postgres", () => postgresDirectPostStore()],
] as [string, () => DirectPostStore][])("%s store, a week of posts", (name, make) => {
  it("lists this person's Mastodon and Bluesky rows in the range by their time, never a cancelled one or a bot place", async () => {
    const s = make();
    const id = (x: string) => `${name}-wk-${x}`;
    await s.schedule("u1", id("in"), mastodon("m1"), later, now);
    await s.schedule("u1", id("gone"), mastodon("m1"), later, now);
    await s.cancel("u1", id("gone"), now);
    await s.schedule("u1", id("tg"), { kind: "telegram", target: "t1", label: "T", text: "x" }, later, now);
    await s.schedule("u1", id("out"), mastodon("m1"), new Date(later.getTime() + 8 * 86_400_000), now);
    const rows = await s.between("u1", new Date(later.getTime() - 3_600_000), new Date(later.getTime() + 3_600_000));
    expect(rows.map((r) => r.postId).filter((p) => p.startsWith(`${name}-wk-`))).toEqual([id("in")]);
  });
  it("control: nobody else's rows", async () => {
    const s = make();
    await s.schedule("u1", `${name}-wk-mine`, mastodon("m1"), later, now);
    expect(await s.between("u2", new Date(0), new Date(later.getTime() + 86_400_000))).toEqual([]);
  });
});
