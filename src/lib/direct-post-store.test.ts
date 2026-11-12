/**
 * @fileoverview The Postgres post store on PGlite with the real migrations: the primary key claim lets one
 * request send a destination, a resend wins once, and users stay apart.
 */
import { migratedPglite } from "@/test/migrated-pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const pg = await migratedPglite();
const testDb = drizzle(pg, { schema: { ...(await import("../db/schema")), ...(await import("../db/auth-schema")) } });
vi.mock("../db", () => ({ db: () => testDb }));
const { postgresDirectPostStore } = await import("./direct-post-store");

const item = { kind: "discord" as const, target: "c1", label: "#announcements", text: "Patch 1.4 is out." };
const now = new Date("2026-11-08T10:00:00Z");

beforeAll(async () => {
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

describe("postgres send-now retry", () => {
  it("picks a send-now post up again after Telegram or Discord said wait", async () => {
    const s = postgresDirectPostStore();
    const tgNow = { kind: "telegram" as const, target: "-200", label: "Now news", text: "Out now." };
    await s.claim("u1", "now1", tgNow, now);
    const until = new Date(now.getTime() + 30_000);
    await s.retryLater("u1", "now1", "telegram", until, now);
    const due = await s.claimDue(new Date(until.getTime() + 1_000), 25);
    expect(due.map((d) => d.postId)).toContain("now1");
  });
});

describe("postgres disconnect", () => {
  it("cancels only that kind of place's waiting posts, and only for that person", async () => {
    const s = postgresDirectPostStore();
    const later = new Date("2026-12-01T09:00:00Z");
    const dc = { kind: "discord" as const, target: "c9", label: "#news", text: "Soon." };
    const tgItem = { kind: "telegram" as const, target: "-9", label: "News", text: "Soon." };
    await s.schedule("u1", "k1", dc, later, now);
    await s.schedule("u1", "k1", tgItem, later, now);
    await s.schedule("u2", "k2", dc, later, now);
    expect(await s.cancelKind("u1", "discord", now)).toBe(1);
    expect((await s.rows("u1", "k1")).map((r) => `${r.kind}:${r.status}`).sort()).toEqual(["discord:cancelled", "telegram:scheduled"]);
    expect((await s.rows("u2", "k2")).map((r) => r.status)).toEqual(["scheduled"]);
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

describe("postgres follow-ups", () => {
  const at = new Date("2026-11-09T18:01:00Z");
  const tg = { kind: "telegram" as const, target: "-100", label: "News", text: "Up now." };

  it("adds a place, updates it while waiting or cancelled, and leaves one that went out", async () => {
    const s = postgresDirectPostStore();
    expect(await s.follow("u1", "fu1", tg, at, now, "bp1")).toBe(true);
    await s.unfollow("u1", "fu1", "telegram", now);
    expect((await s.followedPlaces("u1", ["bp1"])).size).toBe(0);
    expect(await s.follow("u1", "fu1", { ...tg, text: "Back on." }, at, now, "bp1")).toBe(true);
    const [row] = await s.rows("u1", "fu1");
    expect([row.status, row.text, row.revision, row.bufferPostId]).toEqual(["scheduled", "Back on.", 2, "bp1"]);
    expect(await s.followedPlaces("u1", ["bp1", "bp9"])).toEqual(new Set(["bp1|telegram"]));
    await s.claimDue(new Date("2026-11-09T18:02:00Z"), 50, { postId: "fu1", revision: 2 });
    await s.startCall("u1", "fu1", "telegram", now);
    await s.finish("u1", "fu1", "telegram", { status: "sent", link: null, error: null }, now);
    expect(await s.follow("u1", "fu1", { ...tg, text: "Again" }, at, now, "bp1")).toBe(false);
  });

  it("never lets another person overwrite a follow-up", async () => {
    const s = postgresDirectPostStore();
    await s.follow("u1", "fu2", tg, at, now, "bp2");
    expect(await s.follow("u2", "fu2", { ...tg, text: "Mine now" }, at, now, "bp2")).toBe(false);
    expect((await s.rows("u1", "fu2"))[0].text).toBe("Up now.");
  });

  it("puts a claimed place back to wait without a call", async () => {
    const s = postgresDirectPostStore();
    await s.follow("u1", "fu3", tg, at, now, "bp3");
    await s.claimDue(new Date("2026-11-09T18:02:00Z"), 50, { postId: "fu3", revision: 0 });
    const later = new Date("2026-11-09T18:07:00Z");
    await s.defer("u1", "fu3", "telegram", { sendAt: later }, now);
    const [row] = await s.rows("u1", "fu3");
    expect([row.status, row.sendAt?.toISOString(), row.callStartedAt]).toEqual(["scheduled", later.toISOString(), null]);
  });
});

describe("postgres claims after review", () => {
  const at = new Date("2026-11-09T18:01:00Z");
  const tg = { kind: "telegram" as const, target: "-100", label: "News", text: "Up now." };
  const dc = { kind: "discord" as const, target: "c1", label: "S #news", text: "Up.", guildId: "g1" };
  const t = (iso: string) => new Date(iso);

  it("does not take a held place before its hold ends, and keeps its time", async () => {
    const s = postgresDirectPostStore();
    await s.follow("u1", "rv1", tg, at, now, "bp1");
    await s.claimDue(t("2026-11-09T18:02:00Z"), 50, { postId: "rv1", revision: 0 });
    await s.defer("u1", "rv1", "telegram", { holdUntil: t("2026-11-09T18:07:00Z") }, now);
    expect(await s.claimDue(t("2026-11-09T18:05:00Z"), 50, { postId: "rv1", revision: 9 })).toEqual([]);
    const [row] = await s.claimDue(t("2026-11-09T18:08:00Z"), 50, { postId: "rv1", revision: 9 });
    expect([row.postId, row.sendAt?.toISOString()]).toEqual(["rv1", at.toISOString()]);
  });

  it("lets a timer take every place at its revision or older", async () => {
    const s = postgresDirectPostStore();
    await s.follow("u1", "rv2", tg, at, now, "bp2");
    await s.follow("u1", "rv2", tg, at, now, "bp2");
    await s.follow("u1", "rv2", dc, at, now, "bp2");
    const rows = await s.claimDue(t("2026-11-09T18:02:00Z"), 50, { postId: "rv2", revision: 1 });
    expect(rows.map((r) => r.kind).sort()).toEqual(["discord", "telegram"]);
  });

  it("never lets a late finish overwrite a finished place", async () => {
    const s = postgresDirectPostStore();
    await s.claim("u1", "rv3", tg, now);
    await s.startCall("u1", "rv3", "telegram", now);
    await s.finish("u1", "rv3", "telegram", { status: "sent", link: "https://t.me/x/1", error: null }, now);
    await s.finish("u1", "rv3", "telegram", { status: "failed", link: null, error: "late" }, now);
    expect((await s.rows("u1", "rv3"))[0].status).toBe("sent");
  });

  it("never claims a failed follow-up for a resend", async () => {
    const s = postgresDirectPostStore();
    await s.follow("u1", "rv4", tg, at, now, "bp4");
    await s.claimDue(t("2026-11-09T18:02:00Z"), 50, { postId: "rv4", revision: 0 });
    await s.finish("u1", "rv4", "telegram", { status: "failed", link: null, error: "Deleted in Buffer." }, now);
    expect(await s.reclaimFailed("u1", "rv4", "telegram", now)).toBeNull();
    expect(await s.followedPlaces("u1", ["bp4"])).toEqual(new Set());
  });

  it("puts a rate-limited place back to wait and clears its call mark", async () => {
    const s = postgresDirectPostStore();
    await s.schedule("u1", "rv5", tg, at, now);
    await s.claimDue(t("2026-11-09T18:02:00Z"), 50, { postId: "rv5", revision: 0 });
    await s.startCall("u1", "rv5", "telegram", t("2026-11-09T18:02:00Z"));
    await s.retryLater("u1", "rv5", "telegram", t("2026-11-09T18:03:00Z"), now);
    const [row] = await s.rows("u1", "rv5");
    expect([row.status, row.callStartedAt]).toEqual(["scheduled", null]);
    expect(await s.claimDue(t("2026-11-09T18:02:30Z"), 50, { postId: "rv5", revision: 0 })).toEqual([]);
    expect((await s.claimDue(t("2026-11-09T18:03:30Z"), 50, { postId: "rv5", revision: 0 })).map((r) => r.postId)).toEqual(["rv5"]);
  });
});

