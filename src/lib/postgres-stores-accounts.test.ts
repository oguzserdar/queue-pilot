/**
 * @fileoverview The Postgres stores on real Postgres (PGLite with every migration): AI app access, account deletion, AI keys, security activity and data download.
 * Split from postgres-stores.test.ts; the shared database setup is src/test/postgres-stores-setup.ts.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { pg, seedPeople, testDb } from "@/test/postgres-stores-setup";

// The production stores run their exact Drizzle queries against the test database.
vi.mock("../db", () => ({ db: () => testDb, schema: {} }));

const { postgresVoiceStore } = await import("./voice-store");
const { approvalState, approvedApps, recordAppUse, removeUnusedApps, renameApp, revokeApp, stillApproved, consentClientLabel, UNUSED_DAYS } = await import("./ai-access");
const { deleteAccount } = await import("./delete-account");
const { connectCodeFor } = await import("./telegram");
const { postgresRulesStore } = await import("./rules-store");
const { postgresAiKeyStore } = await import("./ai-key-store");
const appSchema = await import("../db/schema");
const { getTableColumns, getTableName, is } = await import("drizzle-orm");
const { PgTable } = await import("drizzle-orm/pg-core");

beforeAll(seedPeople);
afterAll(async () => { await pg.close(); });

describe("AI app access on real Postgres", () => {
  it("shows the registered consent name instead of an opaque id, with safe unnamed fallbacks", async () => {
    await pg.query("insert into oauth_client (id, client_id, name, redirect_uris) values ('consent-grok', 'random-opaque-client-id', ' Grok ', '{https://grok.com/callback}')");
    expect(await consentClientLabel("random-opaque-client-id")).toBe("Grok");
    expect(await consentClientLabel("https://claude.ai/oauth/client.json")).toBe("claude.ai");
    expect(await consentClientLabel("https://chatgpt.com/oauth/codex/client.json")).toBe("Codex");
    expect(await consentClientLabel("https://chatgpt.com/other/client.json")).toBe("chatgpt.com");
    expect(await consentClientLabel("https://chatgpt.com.evil.test/oauth/codex/client.json")).toBe("chatgpt.com.evil.test");
    expect(await consentClientLabel("unknown-opaque-id")).toBe("An AI app");
    expect(await consentClientLabel("javascript:alert(1)")).toBe("An AI app");
    await pg.query("insert into oauth_client (id, client_id, name, redirect_uris) values ('consent-long', 'long-name-client', $1, '{https://x.example/cb}')", [`${"A".repeat(200)} trailing`]);
    const long = await consentClientLabel("long-name-client");
    expect(long).toBe(`${"A".repeat(59)}…`);
  });
  it("lists a user's approved apps and revoke removes the approval and that app's tokens for that user only", async () => {
    const now = "2026-11-03T12:00:00Z";
    const later = "2026-12-03T12:00:00Z";
    // Fixed "now" for the approval checks, so the unused-connection rule never turns this test red later.
    const at = new Date("2026-11-03T13:00:00Z");
    await pg.query("insert into \"user\" (id, name, email) values ('ua', 'A', 'a@x'), ('ub', 'B', 'b@x')");
    await pg.query("insert into oauth_client (id, client_id, name, uri, redirect_uris) values ('c1', 'claude', 'Claude', 'https://claude.ai', '{https://claude.ai/cb}'), ('c2', 'chatgpt', 'ChatGPT', null, '{https://chatgpt.com/cb}')");
    await pg.query(`insert into oauth_consent (id, client_id, user_id, scopes, created_at, updated_at) values
      ('k1', 'claude', 'ua', '{openid}', '${now}', '${now}'), ('k2', 'chatgpt', 'ua', '{openid}', '${later}', '${later}'), ('k3', 'claude', 'ub', '{openid}', '${now}', '${now}')`);
    for (const [id, client, user] of [["r1", "claude", "ua"], ["r2", "claude", "ub"], ["r3", "chatgpt", "ua"]]) {
      await pg.query(`insert into oauth_refresh_token (id, token, client_id, user_id, expires_at, created_at, scopes) values ('${id}', 't-${id}', '${client}', '${user}', '${later}', '${now}', '{openid}')`);
      await pg.query(`insert into oauth_access_token (id, token, client_id, user_id, expires_at, created_at, scopes) values ('a${id}', 'ta-${id}', '${client}', '${user}', '${later}', '${now}', '{openid}')`);
    }
    expect((await approvedApps("ua")).map((a) => a.name)).toEqual(["ChatGPT", "Claude"]);
    expect((await approvedApps("ua")).map((a) => a.brand)).toEqual(["ChatGPT", "Claude"]);
    await pg.query("update oauth_client set redirect_uris = '{https://unrelated.example/cb}' where client_id = 'chatgpt'");
    expect((await approvedApps("ua"))[0]).toMatchObject({ name: "ChatGPT", brand: null });
    // Someone else's approval cannot be revoked.
    expect(await revokeApp("ua", "k3")).toBe(false);
    expect(await stillApproved("ua", "claude", at)).toBe(true);
    expect(await revokeApp("ua", "k1")).toBe(true);
    expect(await stillApproved("ua", "claude", at)).toBe(false);
    expect(await stillApproved("ub", "claude", at)).toBe(true);
    // A banned person's AI app stops at once, even with a valid refresh token; an expired ban no longer counts.
    await pg.query(`update "user" set banned = true where id = 'ub'`);
    expect(await stillApproved("ub", "claude", at)).toBe(false);
    await pg.query(`update "user" set ban_expires = now() - interval '1 day' where id = 'ub'`);
    expect(await stillApproved("ub", "claude", at)).toBe(true);
    await pg.query(`update "user" set banned = false, ban_expires = null where id = 'ub'`);
    expect((await approvedApps("ua")).map((a) => a.name)).toEqual(["ChatGPT"]);
    const left = (q: string) => pg.query<{ id: string }>(q).then((r) => r.rows.map((x) => x.id).sort());
    expect(await left("select id from oauth_refresh_token")).toEqual(["r2", "r3"]);
    expect(await left("select id from oauth_access_token")).toEqual(["ar2", "ar3"]);
    expect((await approvedApps("ub")).map((a) => a.name)).toEqual(["Claude"]);
  });

  it("names a connection, shows where it returns to, and stops and removes one unused for UNUSED_DAYS", async () => {
    const approved = "2026-11-01T12:00:00Z";
    await pg.query("insert into \"user\" (id, name, email) values ('ud', 'D', 'apps-d@x'), ('ue', 'E', 'apps-e@x')");
    // The desktop app registers under another app's name, with that app's callbacks plus a local one.
    await pg.query("insert into oauth_client (id, client_id, name, redirect_uris) values ('c5', 'bot', 'Cursor', '{https://cursor.com/cb,http://localhost:8787/callback}'), ('c6', 'web', 'Grok', '{https://grok.com/cb}')");
    await pg.query(`insert into oauth_consent (id, client_id, user_id, scopes, created_at, updated_at) values
      ('k5', 'bot', 'ud', '{openid}', '${approved}', '${approved}'), ('k6', 'web', 'ud', '{openid}', '${approved}', '${approved}'), ('k7', 'web', 'ue', '{openid}', '${approved}', '${approved}')`);
    const day = (n: number) => new Date(Date.parse(approved) + n * 86_400_000);
    const bot = async (now = day(1)) => (await approvedApps("ud", now)).find((a) => a.consentId === "k5")!;
    expect(await bot()).toMatchObject({ name: "Cursor", label: null, returnsTo: ["cursor.com", "This computer"], unused: false });

    // Naming: only one's own connection, trimmed and capped; an empty name clears it.
    expect(await renameApp("ue", "k5", "Not mine")).toBe(false);
    expect(await renameApp("ud", "k5", "  Grok Bot desktop  ")).toBe(true);
    expect((await bot()).label).toBe("Grok Bot desktop");
    expect(await renameApp("ud", "k5", "x".repeat(200))).toBe(true);
    expect((await bot()).label).toHaveLength(60);
    expect(await renameApp("ud", "k5", "   ")).toBe(true);
    expect((await bot()).label).toBeNull();

    // A call keeps a connection alive; the other one, never used, stops after UNUSED_DAYS.
    await recordAppUse("ud", "bot", day(20));
    const late = day(UNUSED_DAYS + 1);
    expect(await stillApproved("ud", "bot", late)).toBe(true);
    expect(await stillApproved("ud", "web", late)).toBe(false);
    expect(await stillApproved("ud", "web", day(UNUSED_DAYS - 1))).toBe(true);
    expect((await approvedApps("ud", late)).map((a) => [a.consentId, a.unused]).sort((a, b) => String(a[0]).localeCompare(String(b[0])))).toEqual([["k5", false], ["k6", true]]);

    // Removing unused ones touches only this person's unused connections, and takes the name with it.
    await renameApp("ud", "k6", "Old web");
    expect(await removeUnusedApps("ud", late)).toBe(1);
    expect((await approvedApps("ud", late)).map((a) => a.consentId)).toEqual(["k5"]);
    expect((await pg.query("select 1 from qp_ai_app_label where user_id = 'ud'")).rows).toHaveLength(0);
    expect((await approvedApps("ue", late)).map((a) => a.consentId)).toEqual(["k7"]);
  });

  it("counts the 30 days exactly, from the last call or else from approval, per person, and survives calls at once", async () => {
    const approved = "2026-11-01T00:00:00.000Z";
    const DAY = 86_400_000;
    await pg.query("insert into \"user\" (id, name, email) values ('uf', 'F', 'apps-f@x'), ('ug', 'G', 'apps-g@x')");
    await pg.query("insert into oauth_client (id, client_id, name, redirect_uris) values ('c7', 'claude-f', 'Claude', '{https://claude.ai/cb}')");
    await pg.query(`insert into oauth_consent (id, client_id, user_id, scopes, created_at, updated_at) values ('k8', 'claude-f', 'uf', '{openid}', '${approved}', '${approved}')`);
    const at = (ms: number) => new Date(Date.parse(approved) + ms);
    // Never called: counted from approval. Exactly UNUSED_DAYS is still fine; one millisecond more is not.
    expect(await approvalState("uf", "claude-f", at(UNUSED_DAYS * DAY))).toEqual({ state: "approved" });
    expect(await approvalState("uf", "claude-f", at(UNUSED_DAYS * DAY + 1))).toEqual({ state: "unused", consentId: "k8" });
    // Someone else never sees this approval, stale or not.
    expect(await approvalState("ug", "claude-f", at(UNUSED_DAYS * DAY + 1))).toEqual({ state: "none" });
    // Five calls at the same moment all count, and the clock now runs from the last of them.
    const used = at(10 * DAY);
    await Promise.all(Array.from({ length: 5 }, () => recordAppUse("uf", "claude-f", used)));
    expect((await approvedApps("uf", used))[0].calls).toBe(5);
    expect(await approvalState("uf", "claude-f", at(10 * DAY + UNUSED_DAYS * DAY))).toEqual({ state: "approved" });
    expect(await approvalState("uf", "claude-f", at(10 * DAY + UNUSED_DAYS * DAY + 1))).toMatchObject({ state: "unused" });
    // Retiring the stale approval leaves nothing to reuse; a fresh approval starts a fresh clock.
    expect(await revokeApp("uf", "k8")).toBe(true);
    expect(await approvalState("uf", "claude-f", at(60 * DAY))).toEqual({ state: "none" });
    const again = at(60 * DAY).toISOString();
    await pg.query(`insert into oauth_consent (id, client_id, user_id, scopes, created_at, updated_at) values ('k9', 'claude-f', 'uf', '{openid}', '${again}', '${again}')`);
    expect(await approvalState("uf", "claude-f", at(60 * DAY + 1000))).toEqual({ state: "approved" });
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
    await expect(postgresVoiceStore().setNote("nobody", "x")).rejects.toThrow('Failed query: insert into "qp_voice_note"');
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
    expect(events.find((e) => e.event === "app_revoked")?.detail).toEqual({ app: "Claude", verified: "true" });
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
    await pg.query(`insert into qp_material (user_id, key, title, text) values ('ex1', 'm1', 'My launch notes', 'We shipped the calendar.'), ('ex2', 'm2', 'Theirs', 'Not yours.')`);
    // Two versions of one transcript: only the latest is exported, and without its timed segments.
    await pg.query(`insert into qp_source_snapshot (id, user_id, source_key, uri, content_hash, text, checked_by, metadata, fetched_at) values
      ('sn1', 'ex1', 'yt1', 'https://y/1', 'h1', 'Old transcript words.', 'x', '{"kind":"transcript","segments":[{"t":0,"text":"seg-old"}]}', '2026-11-01'),
      ('sn2', 'ex1', 'yt1', 'https://y/1', 'h2', 'New transcript words.', 'x', '{"kind":"transcript","segments":[{"t":0,"text":"seg-new"}]}', '2026-11-05')`);
    const data = await exportUserData("ex1", new Date("2026-11-09T10:00:00Z"));
    const text = JSON.stringify(data);
    // Material the person saved is part of their data; another person's is not.
    expect(text).toContain("We shipped the calendar.");
    expect(text).not.toContain("Not yours.");
    expect(text).toContain("New transcript words.");
    expect(text).not.toContain("Old transcript words.");
    expect(text).not.toContain("seg-new");
    expect(data?.account).toMatchObject({ name: "Mark", email: "mark@x" });
    expect(data?.playbook.rules).toHaveLength(1);
    expect(JSON.stringify(data?.playbook.rules)).toContain("Name the dish first.");
    expect(data?.ai.ownKey).toMatchObject({ provider: "anthropic", model: "claude-a" });
    expect(data?.signedInBrowsers[0]).toMatchObject({ ipAddress: "203.0.113.9" });
    for (const secret of [key, "session-token-secret", "keyEnc", "key_enc", "Someone else's rule"]) expect(text).not.toContain(secret);
    expect(await exportUserData("nobody")).toBeNull();
  });
});
