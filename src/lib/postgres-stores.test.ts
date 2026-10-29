import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Real Postgres (PGLite) with the real migrations applied, behind the app's Drizzle client: the production stores
// run their exact Drizzle queries against it.
const pg = new PGlite();
const testDb = drizzle(pg, { schema: { ...(await import("../db/schema")), ...(await import("../db/auth-schema")) } });
vi.mock("../db", () => ({ db: () => testDb, schema: {} }));

const { postgresEchoStore, postgresTelegramCodes } = await import("./echo-store");
const { postgresSourceStore, MAX_SOURCES, TooManySourcesError } = await import("./sources-store");
const { postgresSnapshotStore } = await import("./buffer/snapshot-store");
const { forgetSettings, postgresSettingsStore, recentSettingChanges, SETTINGS_TTL_MS } = await import("./db");
const { postgresVoiceStore, MAX_EXAMPLES, MAX_NOTE, TooManyExamplesError } = await import("./voice-store");
const { approvedApps, recordAppUse, revokeApp, stillApproved } = await import("./ai-access");
const { deleteAccount } = await import("./delete-account");
const { connectCodeFor } = await import("./telegram");
const { postgresRulesStore, MAX_RULES, TooManyRulesError } = await import("./rules-store");
const { postgresWrittenStore } = await import("./written-store");
const { currentOffers } = await import("./read-back");
const { postgresAiKeyStore } = await import("./ai-key-store");
const appSchema = await import("../db/schema");
const { getTableColumns, getTableName, is } = await import("drizzle-orm");
const { PgTable } = await import("drizzle-orm/pg-core");

beforeAll(async () => {
  await migrate(testDb, { migrationsFolder: join(__dirname, "../../drizzle"), migrationsTable: "__drizzle_migrations__", migrationsSchema: "public" });
  // Every app table references the user row, so the people these tests act for must exist.
  const ids = ["u1", "u2", "u3", "u4", "u5", "u6", "u7", "u8"];
  await pg.query(`insert into "user" (id, name, email) values ${ids.map((id) => `('${id}', '${id}', '${id}@x')`).join(", ")}`);
});
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
    await s.save("u5", { data, rateLimit: [{ policy: "250-in-24h", remaining: 200 }], fetchedAt: t0 } as any);
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

describe("AI app access on real Postgres", () => {
  it("lists a user's approved apps and revoke removes the approval and that app's tokens for that user only", async () => {
    const now = "2026-11-03T12:00:00Z";
    const later = "2026-12-03T12:00:00Z";
    await pg.query("insert into \"user\" (id, name, email) values ('ua', 'A', 'a@x'), ('ub', 'B', 'b@x')");
    await pg.query("insert into oauth_client (id, client_id, name, uri, redirect_uris) values ('c1', 'claude', 'Claude', 'https://claude.ai', '{https://claude.ai/cb}'), ('c2', 'chatgpt', 'ChatGPT', null, '{https://chatgpt.com/cb}')");
    await pg.query(`insert into oauth_consent (id, client_id, user_id, scopes, created_at, updated_at) values
      ('k1', 'claude', 'ua', '{openid}', '${now}', '${now}'), ('k2', 'chatgpt', 'ua', '{openid}', '${later}', '${later}'), ('k3', 'claude', 'ub', '{openid}', '${now}', '${now}')`);
    for (const [id, client, user] of [["r1", "claude", "ua"], ["r2", "claude", "ub"], ["r3", "chatgpt", "ua"]]) {
      await pg.query(`insert into oauth_refresh_token (id, token, client_id, user_id, expires_at, created_at, scopes) values ('${id}', 't-${id}', '${client}', '${user}', '${later}', '${now}', '{openid}')`);
      await pg.query(`insert into oauth_access_token (id, token, client_id, user_id, expires_at, created_at, scopes) values ('a${id}', 'ta-${id}', '${client}', '${user}', '${later}', '${now}', '{openid}')`);
    }
    expect((await approvedApps("ua")).map((a) => a.name)).toEqual(["ChatGPT", "Claude"]);
    // Someone else's approval cannot be revoked.
    expect(await revokeApp("ua", "k3")).toBe(false);
    expect(await stillApproved("ua", "claude")).toBe(true);
    expect(await revokeApp("ua", "k1")).toBe(true);
    expect(await stillApproved("ua", "claude")).toBe(false);
    expect(await stillApproved("ub", "claude")).toBe(true);
    // A banned person's AI app stops at once, even with a valid refresh token; an expired ban no longer counts.
    await pg.query(`update "user" set banned = true where id = 'ub'`);
    expect(await stillApproved("ub", "claude")).toBe(false);
    await pg.query(`update "user" set ban_expires = now() - interval '1 day' where id = 'ub'`);
    expect(await stillApproved("ub", "claude")).toBe(true);
    await pg.query(`update "user" set banned = false, ban_expires = null where id = 'ub'`);
    expect((await approvedApps("ua")).map((a) => a.name)).toEqual(["ChatGPT"]);
    const left = (q: string) => pg.query<{ id: string }>(q).then((r) => r.rows.map((x) => x.id).sort());
    expect(await left("select id from oauth_refresh_token")).toEqual(["r2", "r3"]);
    expect(await left("select id from oauth_access_token")).toEqual(["ar2", "ar3"]);
    expect((await approvedApps("ub")).map((a) => a.name)).toEqual(["Claude"]);
  });

  it("records each connector call, so an approved app that never called says so, and revoking clears the record", async () => {
    await pg.query("insert into \"user\" (id, name, email) values ('uc', 'C', 'c@x')");
    await pg.query("insert into oauth_client (id, client_id, name, redirect_uris) values ('c3', 'grok', 'Grok', '{https://grok.com/cb}')");
    await pg.query(`insert into oauth_consent (id, client_id, user_id, scopes, created_at, updated_at) values
      ('k4', 'grok', 'uc', '{openid}', '2026-11-03T12:00:00Z', '2026-11-03T12:00:00Z')`);
    expect((await approvedApps("uc"))[0]).toMatchObject({ name: "Grok", lastUsedAt: null, calls: 0 });
    await recordAppUse("uc", "grok", new Date("2026-11-03T12:05:00Z"));
    await recordAppUse("uc", "grok", new Date("2026-11-03T12:09:00Z"));
    expect((await approvedApps("uc"))[0]).toMatchObject({ lastUsedAt: "2026-11-03T12:09:00.000Z", calls: 2 });
    expect(await revokeApp("uc", "k4")).toBe(true);
    const rows = await pg.query("select 1 from qp_ai_app_use where user_id = 'uc'");
    expect(rows.rows).toHaveLength(0);
  });
});

describe("deleting an account on real Postgres", () => {
  it("every app table keyed by user_id cascades from the user row", async () => {
    const keyed = (Object.values(appSchema) as unknown[])
      .filter((t): t is InstanceType<typeof PgTable> => is(t, PgTable))
      .filter((t) => "userId" in getTableColumns(t))
      .map((t) => getTableName(t))
      .sort();
    const { rows } = await pg.query<{ table_name: string }>(`
      select tc.table_name from information_schema.table_constraints tc
      join information_schema.referential_constraints rc on rc.constraint_name = tc.constraint_name
      join information_schema.constraint_column_usage cu on cu.constraint_name = rc.unique_constraint_name
      join information_schema.key_column_usage kc on kc.constraint_name = tc.constraint_name
      where tc.constraint_type = 'FOREIGN KEY' and cu.table_name = 'user' and kc.column_name = 'user_id' and rc.delete_rule = 'CASCADE'`);
    for (const t of keyed) expect(rows.map((r) => r.table_name)).toContain(t);
  });

  it("a write for a deleted person fails instead of leaving an orphan", async () => {
    await expect(postgresVoiceStore().setNote("nobody", "x")).rejects.toThrow();
  });

  it("removes the person's data and sign-in, and nobody else's", async () => {
    const now = "2026-11-03T12:00:00Z";
    await pg.query("insert into \"user\" (id, name, email) values ('gone', 'G', 'g@x'), ('kept', 'K', 'k@x')");
    await pg.query(`insert into session (id, expires_at, token, user_id, updated_at) values ('s1', '${now}', 't1', 'gone', '${now}'), ('s2', '${now}', 't2', 'kept', '${now}')`);
    for (const u of ["gone", "kept"]) {
      await postgresVoiceStore().setNote(u, "plain");
      await postgresVoiceStore().addExample(u, { postId: "p", channel: "X", text: "t" });
      await pg.query(`insert into buffer_snapshot (user_id, data) values ('${u}', '{}')`);
    }
    const ids = (q: string) => pg.query<{ v: string }>(q).then((r) => r.rows.map((x) => x.v).sort());
    const secret = "test-secret";
    const code = connectCodeFor("gone", secret, new Date());
    await pg.query(`insert into qp_telegram_code (code, chat_id, title) values ('${code}', '-100', 'Gone channel'), ('other-code-1', '-200', 'Kept channel')`);
    await deleteAccount("gone", secret);
    expect(await ids("select code as v from qp_telegram_code where code in ('${code}', 'other-code-1')")).toEqual(["other-code-1"]);
    expect(await postgresVoiceStore().get("gone")).toEqual({ examples: [], note: null });
    expect((await postgresVoiceStore().get("kept")).note).toBe("plain");
    expect(await ids("select user_id as v from buffer_snapshot where user_id in ('gone', 'kept')")).toEqual(["kept"]);
    expect(await ids("select user_id as v from session where user_id in ('gone', 'kept')")).toEqual(["kept"]);
    expect(await ids("select id as v from \"user\" where id in ('gone', 'kept')")).toEqual(["kept"]);
  });
});

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

describe("AI key store on real Postgres", () => {
  const master = "ab".repeat(32);
  const key = "sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123";

  it("stores the key encrypted, shows it masked, replaces it, and removes it", async () => {
    await pg.query(`insert into "user" (id, name, email) values ('k1', 'k1', 'k1@x')`);
    const s = postgresAiKeyStore(master);
    expect(await s.get("k1")).toBeNull();
    await s.set("k1", "anthropic", key, "claude-a");
    const { rows } = await pg.query<{ key_enc: string }>(`select key_enc from qp_ai_key where user_id = 'k1'`);
    expect(rows[0].key_enc).not.toContain("abcdefghijkl");
    expect(await s.get("k1")).toEqual({ provider: "anthropic", key, model: "claude-a" });
    expect(await s.shown("k1")).toEqual({ provider: "anthropic", masked: "sk-ant-••••0123", model: "claude-a" });
    await s.setModel("k1", "claude-b");
    expect((await s.get("k1"))?.model).toBe("claude-b");
    await s.set("k1", "openai", "sk-proj-zyxwvutsrqponmlkjihgfedcba9876", "gpt-x");
    expect((await s.get("k1"))?.provider).toBe("openai");
    await s.remove("k1");
    expect(await s.get("k1")).toBeNull();
  });

  it("goes with the account when the person deletes it", async () => {
    await pg.query(`insert into "user" (id, name, email) values ('k2', 'k2', 'k2@x')`);
    await postgresAiKeyStore(master).set("k2", "anthropic", key, "claude-a");
    await deleteAccount("k2");
    const { rows } = await pg.query(`select 1 from qp_ai_key where user_id = 'k2'`);
    expect(rows).toHaveLength(0);
  });
});

describe("security activity on real Postgres", () => {
  it("records sign-ins and revoked apps, and deleting the account removes the person's events but keeps one anonymous record", async () => {
    const { recordSecurityEvent, recentSecurityEvents } = await import("./security-events");
    const { deleteAccount } = await import("./delete-account");
    await pg.query("insert into \"user\" (id, name, email) values ('us', 'S', 's@x')");
    await pg.query("insert into oauth_client (id, client_id, name, redirect_uris) values ('cs', 'claude-s', 'Claude', '{https://claude.ai/cb}')");
    await pg.query(`insert into oauth_consent (id, client_id, user_id, scopes, created_at, updated_at) values ('ks', 'claude-s', 'us', '{openid}', now(), now())`);
    await recordSecurityEvent("us", "sign_in", { ip: "203.0.113.7", userAgent: "Mozilla/5.0 (Macintosh) Chrome/140" });
    expect(await revokeApp("us", "ks")).toBe(true);
    const events = await recentSecurityEvents("us");
    expect(events.map((e) => e.event).sort()).toEqual(["app_revoked", "sign_in"]);
    expect(events.find((e) => e.event === "app_revoked")?.detail).toEqual({ app: "Claude" });
    const deletedBefore = (await pg.query<{ n: number }>("select count(*)::int as n from qp_security_event where event = 'account_deleted'")).rows[0].n;
    await deleteAccount("us");
    expect((await pg.query("select 1 from qp_security_event where user_id = 'us'")).rows).toHaveLength(0);
    const deleted = await pg.query<{ n: number; withPerson: number }>("select count(*)::int as n, count(user_id)::int + count(ip)::int as \"withPerson\" from qp_security_event where event = 'account_deleted'");
    expect(deleted.rows[0]).toEqual({ n: deletedBefore + 1, withPerson: 0 });
  });
});

describe("download my data on real Postgres", () => {
  it("exports the person's own data and never a key or a token", async () => {
    const { exportUserData } = await import("./export-data");
    const key = "sk-ant-api03-exportsecret0123456789abcdef";
    await pg.query(`insert into "user" (id, name, email) values ('ex1', 'Mark', 'mark@x'), ('ex2', 'Other', 'o@x')`);
    await postgresRulesStore().add("ex1", { kind: "guidance", channels: "all", level: "warn", text: "Name the dish first." });
    await postgresRulesStore().add("ex2", { kind: "guidance", channels: "all", level: "warn", text: "Someone else's rule." });
    await postgresAiKeyStore("ab".repeat(32)).set("ex1", "anthropic", key, "claude-a");
    await pg.query(`insert into session (id, token, user_id, expires_at, created_at, updated_at, ip_address) values ('sx', 'session-token-secret', 'ex1', now() + interval '1 day', now(), now(), '203.0.113.9')`);
    const data = await exportUserData("ex1", new Date("2026-11-09T10:00:00Z"));
    const text = JSON.stringify(data);
    expect(data?.account).toMatchObject({ name: "Mark", email: "mark@x" });
    expect(data?.playbook.rules).toHaveLength(1);
    expect(JSON.stringify(data?.playbook.rules)).toContain("Name the dish first.");
    expect(data?.ai.ownKey).toMatchObject({ provider: "anthropic", model: "claude-a" });
    expect(data?.signedInBrowsers[0]).toMatchObject({ ipAddress: "203.0.113.9" });
    for (const secret of [key, "session-token-secret", "keyEnc", "key_enc", "Someone else's rule"]) expect(text).not.toContain(secret);
    expect(await exportUserData("nobody")).toBeNull();
  });
});
