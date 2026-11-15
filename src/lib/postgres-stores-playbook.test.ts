/**
 * @fileoverview The Postgres stores on real Postgres (PGLite with every migration): rules, written drafts, fix dismissals, read-back, saved fix answers and shared rule exceptions.
 * Split from postgres-stores.test.ts; the shared database setup is src/test/postgres-stores-setup.ts.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { pg, seedPeople, testDb } from "@/test/postgres-stores-setup";

// The production stores run their exact Drizzle queries against the test database.
vi.mock("../db", () => ({ db: () => testDb, schema: {} }));

const { postgresSnapshotStore } = await import("./buffer/snapshot-store");
const { postgresRulesStore, MAX_RULES, TooManyRulesError } = await import("./rules-store");
const { postgresWrittenStore } = await import("./written-store");
const { currentOffers } = await import("./read-back");
const { postgresVerdictStore, checkKey, CLEAR_TTL_MS, UNCLEAR_TTL_MS, CLAIM_TTL_MS } = await import("./fix-verdicts");

beforeAll(seedPeople);
afterAll(async () => { await pg.close(); });

describe("rules store on real Postgres", () => {
  it("keeps each person's rules apart, in the order they were added", async () => {
    const s = postgresRulesStore();
    const a = await s.add("u7", { kind: "replace", from: "broth", to: "stock", channels: "all", level: "block", text: 'Say "stock", never "broth".' }, 4);
    await s.add("u7", { kind: "guidance", channels: ["linkedin"], level: "warn", text: "Name the dish in the first line." });
    await s.add("u8", { kind: "banned", phrases: ["Excited to share"], channels: "all", level: "block", text: "No hype openings." });
    const mine = await s.list("u7");
    expect(mine.map((r) => r.text)).toEqual(['Say "stock", never "broth".', "Name the dish in the first line."]);
    expect(mine[0]).toMatchObject({ id: a, kind: "replace", from: "broth", to: "stock", fixes: 4 });
    expect((await s.list("u8")).length).toBe(1);
  });

  it("deletes only the owner's rule", async () => {
    const s = postgresRulesStore();
    const [theirs] = await s.list("u8");
    await s.remove("u7", theirs.id);
    expect((await s.list("u8")).length).toBe(1);
    await s.remove("u8", theirs.id);
    expect(await s.list("u8")).toEqual([]);
  });

  it("refuses a rule past the limit", async () => {
    const s = postgresRulesStore();
    for (let i = 0; i < MAX_RULES; i++) await s.add("u6", { kind: "guidance", channels: "all", level: "warn", text: `Rule ${i}` });
    await expect(s.add("u6", { kind: "guidance", channels: "all", level: "warn", text: "One more" })).rejects.toBeInstanceOf(TooManyRulesError);
  });
});

describe("written store on real Postgres", () => {
  it("records what was saved, replaces it when the post is saved again, and keeps people apart", async () => {
    const s = postgresWrittenStore();
    await s.record("u5", [{ postId: "p1", network: "linkedin", text: "A broth for winter." }, { postId: "p2", network: "x", text: "Soup." }]);
    await s.record("u5", [{ postId: "p1", network: "linkedin", text: "A broth for winter nights." }]);
    await s.record("u4", [{ postId: "p1", network: "x", text: "Someone else's." }]);
    const mine = await s.get("u5", ["p1", "p2", "nope"]);
    expect(mine.find((w) => w.postId === "p1")?.text).toBe("A broth for winter nights.");
    expect(mine.length).toBe(2);
    expect((await s.get("u4", ["p1"]))[0].text).toBe("Someone else's.");
    expect(await s.get("u5", [])).toEqual([]);
  });
});

describe("fix dismissals on real Postgres", () => {
  it("remembers Not now per person, once", async () => {
    const s = postgresRulesStore();
    await s.dismiss("u5", "linkedin|replace|broth>stock");
    await s.dismiss("u5", "linkedin|replace|broth>stock");
    expect([...(await s.dismissed("u5"))]).toEqual(["linkedin|replace|broth>stock"]);
    expect((await s.dismissed("u4")).size).toBe(0);
  });
});

describe("read-back on real Postgres: edits in Buffer become a playbook offer", () => {
  it("offers a fix made in two drafts, and stops once it is kept or set aside", async () => {
    const post = (id: string, text: string) => ({ id, channelId: "li", status: "draft", text, dueAt: "2026-11-02T09:00:00Z", sentAt: null, externalLink: null, error: null });
    await postgresSnapshotStore().save("u3", {
      data: { email: "u3@x", organizationIds: ["o"], channels: [], posts: [post("p1", "A good stock starts cold."), post("p2", "Stock is the base of winter."), post("pending:li@x", "")] },
      fetchedAt: new Date(), rateLimit: [],
    } as never);
    await postgresWrittenStore().record("u3", [
      { postId: "p1", network: "linkedin", text: "A good broth starts cold." },
      { postId: "p2", network: "linkedin", text: "Broth is the base of winter." },
    ]);
    const [offer] = await currentOffers("u3");
    expect(offer).toMatchObject({ fix: { kind: "replace", from: "broth", to: "stock" }, network: "linkedin", count: 2 });

    await postgresRulesStore().dismiss("u3", offer.key);
    expect(await currentOffers("u3")).toEqual([]);
  });

  it("offers nothing when the person has no saved copy yet", async () => {
    expect(await currentOffers("u2")).toEqual([]);
  });
});

describe("saved repeated-fix answers", () => {
  it("returns answers only to the same user, for the same check, until they expire", async () => {
    const store = postgresVerdictStore();
    const now = new Date("2026-10-30T12:00:00Z");
    const clear = [{ candidate: 1, verdict: "preference" as const, why: "Both drafts cut the hype.", rule: "Keep it." }];
    await store.put("u1", "k1", (await store.claim("u1", "k1", now))!, clear, now);
    expect(await store.get("u1", "k1", now)).toEqual({ kind: "answer", verdicts: clear });
    expect(await store.get("u2", "k1", now)).toBeNull();
    expect(await store.get("u1", "k2", now)).toBeNull();
    expect(await store.get("u1", "k1", new Date(now.getTime() + CLEAR_TTL_MS + 1))).toBeNull();
  });

  it("keeps an unclear answer for minutes, and a new check after that replaces it", async () => {
    const store = postgresVerdictStore();
    const now = new Date("2026-10-30T12:00:00Z");
    await store.put("u1", "k3", (await store.claim("u1", "k3", now))!, [{ candidate: 1, verdict: "unclear", why: "Could be chance.", rule: "" }], now);
    const lapsed = new Date(now.getTime() + UNCLEAR_TTL_MS + 1);
    expect(await store.get("u1", "k3", lapsed)).toBeNull();
    await store.put("u1", "k3", (await store.claim("u1", "k3", lapsed))!, [{ candidate: 1, verdict: "fact", why: "A corrected link.", rule: "" }], lapsed);
    expect(await store.get("u1", "k3", lapsed)).toEqual({ kind: "answer", verdicts: [{ candidate: 1, verdict: "fact", why: "A corrected link.", rule: "" }] });
  });

  it("lets one check claim the key, shows it busy to the next, and frees an unfinished or lapsed claim", async () => {
    const store = postgresVerdictStore();
    const now = new Date("2026-10-30T13:00:00Z");
    const a = await store.claim("u1", "k4", now);
    expect(a).toBeTruthy();
    expect(await store.claim("u1", "k4", now)).toBeNull();
    expect(await store.get("u1", "k4", now)).toEqual({ kind: "busy" });
    expect(await store.claim("u2", "k4", now)).toBeTruthy();
    await store.release("u1", "k4", a!);
    expect(await store.get("u1", "k4", now)).toBeNull();
    const b = await store.claim("u1", "k4", now);
    await store.put("u1", "k4", b!, [{ candidate: 1, verdict: "preference", why: "Same cut twice.", rule: "Keep it." }], now);
    await store.release("u1", "k4", b!);
    expect((await store.get("u1", "k4", now))?.kind).toBe("answer");
    expect(await store.claim("u1", "k4", now)).toBeNull();
  });

  it("never lets a late check erase or overwrite a newer one after its claim lapsed", async () => {
    const store = postgresVerdictStore();
    const t0 = new Date("2026-10-30T14:00:00Z");
    const later = new Date(t0.getTime() + CLAIM_TTL_MS + 1);
    const a = await store.claim("u1", "k5", t0);
    const b = await store.claim("u1", "k5", later);
    expect(b).toBeTruthy();
    expect(b).not.toBe(a);
    await store.release("u1", "k5", a!);
    expect(await store.get("u1", "k5", later)).toEqual({ kind: "busy" });
    expect(await store.claim("u1", "k5", later)).toBeNull();
    const fact = [{ candidate: 1, verdict: "fact" as const, why: "A corrected date.", rule: "" }];
    await store.put("u1", "k5", b!, fact, later);
    await store.put("u1", "k5", a!, [{ candidate: 1, verdict: "preference", why: "Late and stale.", rule: "Keep it." }], later);
    expect(await store.get("u1", "k5", later)).toEqual({ kind: "answer", verdicts: fact });
  });

  it("does not recreate a row when a late check finishes after its claim was cleared", async () => {
    const store = postgresVerdictStore();
    const t0 = new Date("2026-10-30T15:00:00Z");
    const a = await store.claim("u1", "k6", t0);
    await store.put("u1", "k7", (await store.claim("u1", "k7", t0))!, [], new Date(t0.getTime() + CLAIM_TTL_MS + 1));
    expect(await store.get("u1", "k6", t0)).toBeNull();
    await store.put("u1", "k6", a!, [{ candidate: 1, verdict: "preference", why: "Too late.", rule: "Keep it." }], t0);
    expect(await store.get("u1", "k6", t0)).toBeNull();
  });
});

describe("shared rule exceptions on real Postgres", () => {
  it("switches a shared rule off and back on for one network, and leaves a named-network rule alone", async () => {
    const s = postgresRulesStore();
    const shared = await s.add("u5", { kind: "guidance", channels: "all", level: "warn", text: "Shared rule" });
    const named = await s.add("u5", { kind: "guidance", channels: ["twitter"], level: "warn", text: "Named rule" });
    const read = async (id: string) => (await s.list("u5")).find((r) => r.id === id);
    expect(await s.setException("u5", shared, "linkedin", true)).toBe(true);
    expect(await s.setException("u5", shared, "linkedin", true)).toBe(true);
    expect(await s.setException("u5", shared, "bluesky", true)).toBe(true);
    expect((await read(shared))?.except).toEqual(["bluesky", "linkedin"]);
    expect(await s.setException("u5", shared, "linkedin", false)).toBe(true);
    expect((await read(shared))?.except).toEqual(["bluesky"]);
    expect(await s.setException("u5", named, "twitter", true)).toBe(false);
    expect(await s.setException("u6", shared, "twitter", true)).toBe(false);
    expect((await read(shared))?.except).toEqual(["bluesky"]);
  });
});

it("keeps saved learning verdicts separate for two accounts with identical edits", () => {
  const offer = { fix: { kind: "banned" as const, phrase: "excited" }, network: "linkedin", count: 2, examples: [] };
  expect(checkKey([{ ...offer, channelId: "company" }])).not.toBe(checkKey([{ ...offer, channelId: "personal" }]));
});
