/**
 * @fileoverview The Postgres stores on real Postgres (PGLite with every migration): echo, sources, snapshot, settings, voice and research-material stores.
 * Split from postgres-stores.test.ts; the shared database setup is src/test/postgres-stores-setup.ts.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { pg, seedPeople, testDb } from "@/test/postgres-stores-setup";

// The production stores run their exact Drizzle queries against the test database.
vi.mock("../db", () => ({ db: () => testDb, schema: {} }));

const { postgresEchoStore, postgresTelegramCodes } = await import("./echo-store");
const { postgresSourceStore, MAX_SOURCES, TooManySourcesError } = await import("./sources-store");
const { postgresSnapshotStore } = await import("./buffer/snapshot-store");
const { forgetSettings, postgresSettingsStore, recentSettingChanges, SETTINGS_TTL_MS } = await import("./db");
const { postgresVoiceStore, MAX_EXAMPLES, MAX_NOTE, TooManyExamplesError } = await import("./voice-store");
const { addPastedExample } = await import("./voice-store");
const { postgresMaterialStore } = await import("./material-store");

beforeAll(seedPeople);
afterAll(async () => { await pg.close(); });

describe("echo store on real Postgres", () => {
  it("claims a copy once, frees it after expiry, and never after it landed", async () => {
    const s = postgresEchoStore();
    const t0 = new Date("2026-11-03T12:00:00Z");
    const later = (ms: number) => new Date(t0.getTime() + ms);
    expect(await s.claim("u1", "p1", "d1", t0, later(600_000))).toBe(true);
    expect(await s.claim("u1", "p1", "d1", later(1_000), later(601_000))).toBe(false);
    expect(await s.claim("u1", "p1", "d1", later(700_000), later(1_300_000))).toBe(true);
    await s.record("u1", { postId: "p1", destinationId: "d1", status: "sent", attempts: 1, messageId: "m" });
    expect(await s.claim("u1", "p1", "d1", later(5_000_000), later(5_600_000))).toBe(false);
  });

  it("never overwrites a copy that landed with a later failure", async () => {
    const s = postgresEchoStore();
    await s.record("u1", { postId: "p2", destinationId: "d1", status: "sent", attempts: 1, messageId: "m1" });
    await s.record("u1", { postId: "p2", destinationId: "d1", status: "failed", attempts: 2, error: "x" });
    expect(await s.records("u1", ["p2"])).toEqual([{ postId: "p2", destinationId: "d1", status: "sent", attempts: 1, messageId: "m1" }]);
  });

  it("keeps one destination per kind, with a new id on replace, and lists users that have one", async () => {
    const s = postgresEchoStore();
    const a = await s.setDestination("u2", { kind: "telegram", label: "A", target: "-1" });
    const b = await s.setDestination("u2", { kind: "telegram", label: "B", target: "-2" });
    expect(b.id).not.toBe(a.id);
    expect((await s.destinations("u2")).map((d) => d.label)).toEqual(["B"]);
    expect(await s.usersWithDestinations()).toContain("u2");
    await s.removeDestination("u2", "telegram");
    expect(await s.destinations("u2")).toEqual([]);
  });

  it("the database itself refuses a destination kind or copy status it does not know", async () => {
    await expect(pg.query("insert into qp_echo_destination (id, user_id, kind, label, target) values ('x', 'u', 'slack', 'l', 't')")).rejects.toThrow(/invalid input value for enum/);
    await expect(pg.query("insert into qp_echo (user_id, post_id, destination_id, status, attempts) values ('u', 'p', 'd', 'lost', 1)")).rejects.toThrow(/invalid input value for enum/);
  });

  it("keeps the first chat that carried a Telegram code", async () => {
    const c = postgresTelegramCodes();
    await c.save([{ code: "maple-orbit-4821", chatId: -1001, title: "Mine" }]);
    await c.save([{ code: "maple-orbit-4821", chatId: -666, title: "Replay" }]);
    expect(await c.find("maple-orbit-4821")).toEqual({ chatId: -1001, title: "Mine" });
  });
});

describe("sources store on real Postgres", () => {
  it("dedupes by URL, caps at the limit, and marks used keys once", async () => {
    const s = postgresSourceStore();
    const a = await s.add("u3", "https://x.example/feed", "Blog");
    expect((await s.add("u3", "https://x.example/feed", "Again")).id).toBe(a.id);
    for (let i = 1; i < MAX_SOURCES; i++) await s.add("u3", `https://x.example/${i}`, `F${i}`);
    await expect(s.add("u3", "https://x.example/extra", "X")).rejects.toBeInstanceOf(TooManySourcesError);
    await s.markUsed("u3", ["k1", "k1", "k2"]);
    expect([...(await s.usedKeys("u3"))].sort()).toEqual(["k1", "k2"]);
    expect((await s.usedKeys("u4")).size).toBe(0);
  });
});

describe("snapshot store on real Postgres", () => {
  it("lets one refresher win the claim until it is released or expires, and saves and reads the copy", async () => {
    const s = postgresSnapshotStore();
    const t0 = new Date("2026-11-03T12:00:00Z");
    const at = (ms: number) => new Date(t0.getTime() + ms);
    expect(await s.get("u5")).toBeNull();
    expect(await s.claim("u5", t0, at(60_000))).toBe(true);
    expect(await s.claim("u5", at(1_000), at(61_000))).toBe(false);
    await s.release("u5");
    expect(await s.claim("u5", at(2_000), at(62_000))).toBe(true);
    expect(await s.claim("u5", at(70_000), at(130_000))).toBe(true);
    const data = { email: "e@x", organizationIds: ["o"], channels: [], posts: [], truncated: false, range: { start: "a", end: "b" } };
    await s.save("u5", { data, rateLimit: [{ policy: "250-in-24h", remaining: 200 }], fetchedAt: t0 } as unknown as import("./buffer/snapshot").Snapshot);
    const got = await s.get("u5");
    expect(got?.data).toEqual(data);
    expect(got?.fetchedAt.toISOString()).toBe(t0.toISOString());
    expect(got?.rateLimit).toEqual([{ policy: "250-in-24h", remaining: 200 }]);
  });
});

describe("settings store on real Postgres", () => {
  it("saves, replaces, reads and removes a setting", async () => {
    const s = postgresSettingsStore();
    expect(await s.get("buffer_client_id")).toBeNull();
    await s.set("buffer_client_id", "first");
    await s.set("buffer_client_id", "second");
    expect(await s.get("buffer_client_id")).toBe("second");
    await s.remove("buffer_client_id");
    expect(await s.get("buffer_client_id")).toBeNull();
  });

  it("records every change, with old and new values for plain settings and never a secret's value", async () => {
    const s = postgresSettingsStore();
    await s.set("ai_budget_usd", "400.00");
    await s.set("ai_budget_usd", "500.00");
    await s.set("fallback_ai_key", "v1:encrypted-blob");
    await s.remove("fallback_ai_key");
    const changes = (await recentSettingChanges()).map((c) => [c.key, c.action, c.fromValue, c.toValue]);
    expect(changes.slice(0, 4)).toEqual([
      ["fallback_ai_key", "cleared", null, null],
      ["fallback_ai_key", "set", null, null],
      ["ai_budget_usd", "set", "400.00", "500.00"],
      ["ai_budget_usd", "set", null, "400.00"],
    ]);
  });

  it("serves settings from this server's copy, and picks up another server's change after the check interval", async () => {
    forgetSettings();
    const s = postgresSettingsStore();
    await s.set("ai_cap_per_person", "10");
    expect(await s.get("ai_cap_per_person")).toBe("10");
    // Another server saves a change: the row and its audit entry, written directly.
    await pg.query("update operator_settings set value = '25' where key = 'ai_cap_per_person'");
    await pg.query("insert into qp_settings_audit (key, action, from_value, to_value) values ('ai_cap_per_person', 'set', '10', '25')");
    expect(await s.get("ai_cap_per_person")).toBe("10");
    const later = Date.now() + SETTINGS_TTL_MS + 1;
    const now = vi.spyOn(Date, "now").mockReturnValue(later);
    try {
      expect(await s.get("ai_cap_per_person")).toBe("25");
    } finally {
      now.mockRestore();
    }
  });

  it("marks a row saved before this release as older, until it is saved again or kept", async () => {
    forgetSettings();
    const s = postgresSettingsStore();
    // How a pre-release row looks: written without the mark that a saved value wins.
    await pg.query("insert into operator_settings (key, value) values ('exa_api_key', 'v1:old-blob'), ('supadata_api_key', 'v1:old-blob')");
    await pg.query("insert into qp_settings_audit (key, action) values ('exa_api_key', 'set')");
    expect(await s.legacy("exa_api_key")).toBe(true);
    expect(await s.legacy("supadata_api_key")).toBe(true);
    await s.set("exa_api_key", "v1:new-blob");
    expect(await s.legacy("exa_api_key")).toBe(false);
    expect(await s.keep("supadata_api_key")).toBe(true);
    expect(await s.legacy("supadata_api_key")).toBe(false);
    expect(await s.keep("supadata_api_key")).toBe(false);
    expect(await s.keep("discord_bot_token")).toBe(false);
    const [kept] = await recentSettingChanges(1);
    expect([kept.key, kept.action, kept.fromValue, kept.toValue]).toEqual(["supadata_api_key", "kept", null, null]);
  });

  it("loads once for many readers at the same moment", async () => {
    forgetSettings();
    const s = postgresSettingsStore();
    const spy = vi.spyOn(pg, "query");
    const values = await Promise.all(Array.from({ length: 8 }, () => s.get("ai_cap_per_person")));
    const queries = spy.mock.calls.length;
    spy.mockRestore();
    expect(new Set(values).size).toBe(1);
    // One load is two queries (the version and the rows), however many readers asked at once.
    expect(queries).toBeLessThanOrEqual(2);
  });
});

describe("voice store on real Postgres", () => {
  it("stores pasted examples without Buffer and removes only the owner's copy", async () => {
    const store = postgresVoiceStore()
    await addPastedExample(store, "u3", "  My\u200b post\nMore text  ")
    const example = (await store.get("u3")).examples[0]
    expect(example).toEqual({ postId: expect.stringMatching(/^pasted:/), channel: "Pasted", text: "My post\nMore text" })
    await store.removeExample("u4", example.postId)
    expect((await store.get("u3")).examples).toHaveLength(1)
    await store.removeExample("u3", example.postId)
    expect((await store.get("u3")).examples).toEqual([])
  })

  it("keeps examples once each, caps them, and keeps users apart", async () => {
    const v = postgresVoiceStore();
    await v.addExample("u6", { postId: "p1", channel: "X", text: "Shipped CSV export." });
    await v.addExample("u6", { postId: "p1", channel: "X", text: "duplicate" });
    for (let i = 2; i <= MAX_EXAMPLES; i++) await v.addExample("u6", { postId: `p${i}`, channel: "X", text: `t${i}` });
    await expect(v.addExample("u6", { postId: "extra", channel: "X", text: "x" })).rejects.toBeInstanceOf(TooManyExamplesError);
    const got = await v.get("u6");
    expect(got.examples).toHaveLength(MAX_EXAMPLES);
    expect(got.examples[0]).toEqual({ postId: "p1", channel: "X", text: "Shipped CSV export." });
    await v.removeExample("u6", "p1");
    expect((await v.get("u6")).examples).toHaveLength(MAX_EXAMPLES - 1);
    expect(await v.get("u7")).toEqual({ examples: [], note: null });
  });

  it("never goes over the cap when adds race, and drops invisible characters", async () => {
    const v = postgresVoiceStore();
    await Promise.all(Array.from({ length: MAX_EXAMPLES + 4 }, (_, i) => v.addExample("u5", { postId: `r${i}`, channel: "X", text: `t${i}` }).catch(() => undefined)));
    expect((await v.get("u5")).examples).toHaveLength(MAX_EXAMPLES);
    await v.removeExample("u5", "r0");
    await v.addExample("u5", { postId: "hidden", channel: "X", text: "Shipped\u200b v2\u202e.\u{E0049}\u{E0067}\nNext line" });
    expect((await v.get("u5")).examples.find((e) => e.postId === "hidden")?.text).toBe("Shipped v2.\nNext line");
  });

  it("saves, replaces, trims and clears the note", async () => {
    const v = postgresVoiceStore();
    await v.setNote("u8", "  short, plain, no emojis  ");
    expect((await v.get("u8")).note).toBe("short, plain, no emojis");
    await v.setNote("u8", "x".repeat(MAX_NOTE + 50));
    expect((await v.get("u8")).note).toHaveLength(MAX_NOTE);
    await v.setNote("u8", "   ");
    expect((await v.get("u8")).note).toBeNull();
  });
});

describe("research material on real Postgres", () => {
  it("scopes reads, retries and used keys to the person", async () => {
    const store = postgresMaterialStore()
    const input = { title: "Notes", text: "The full release text", link: "https://example.com/release" }
    const item = await store.add("u1", input)
    expect(await store.add("u1", input)).toEqual(item)
    expect(await store.get("u2", item.key)).toBeNull()
    expect((await store.list("u1")).rows).toEqual([item])
    await store.add("u2", input)
    await postgresSourceStore().markUsed("u1", [item.key])
    expect((await store.list("u1")).rows).toEqual([])
    expect((await store.list("u2")).rows).toEqual([item])
    expect(await store.get("u1", item.key)).toEqual(item)
    await store.remove("u1", item.key)
    expect(await store.get("u1", item.key)).toBeNull()
    expect(await store.get("u2", item.key)).toEqual(item)
    await store.add("u1", input)
    expect((await store.list("u1")).rows).toEqual([]) // used history survives cleanup
    await expect(store.add("u1", { title: " ", text: "x" })).rejects.toThrow("Too small: expected string to have >=1 characters")
    await expect(store.add("u1", { title: "Notes", text: "x".repeat(12_001) })).rejects.toThrow("Too big: expected string to have <=12000 characters")
  })
})
