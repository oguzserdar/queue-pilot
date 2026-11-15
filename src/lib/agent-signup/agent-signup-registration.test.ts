/**
 * @fileoverview Agent sign-up end to end on PGlite with every migration: registering, the per-address limit, the operator's switch, the token trade and the account's clock.
 * The real /v1 routes, the real Better Auth instance signing on the same database, and the real claim transaction;
 * nothing about tokens or the database is stubbed. Split from agent-signup.test.ts; shared setup is
 * src/test/agent-signup-setup.ts.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { BASE, DAY, HOUR, acceptClaim, accountRoute, backdate, call, claimView, clearOperatorSettingsCache, count, draftsRoute, forgetSettings, invokeAdminOperation, materialRoute, newAgent, nextIp, pg, register, seedPeople, server, signupOn, tokenOf, tokenRoute, trade, type Row } from "@/test/agent-signup-setup";

vi.mock("@/db", async () => {
  const { schema, testDb } = await import("@/test/agent-signup-db");
  return { db: () => testDb, schema };
});
vi.mock("@/lib/auth", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/auth")>();
  const { BASE } = await import("@/test/agent-signup-db");
  const auth = real.buildAuth({ clientId: "test", secret: "test-secret-".padEnd(40, "x"), baseURL: BASE });
  return { ...real, getAuth: async () => auth };
});

beforeAll(seedPeople);
beforeEach(signupOn);
afterAll(async () => { await pg.close(); });

describe("registering", () => {
  it("answers 201 with the assertion, the account block (claim_url, freeze_at, delete_at) and the capability list", async () => {
    const usersBefore = await count(`"user"`);
    const before = Date.now();
    const r = await register({ type: "anonymous", tool: "test-agent", label: "Ada's laptop", login_hint: "Ada@X.test", source: "skill:queue-pilot" });
    expect(r.status).toBe(201);
    expect(r.headers.get("cache-control")).toBe("no-store");
    const { registration_id, identity_assertion, assertion_expires, account, capabilities } = r.json;
    expect(registration_id).toMatch(/^reg_/);
    expect(identity_assertion.split(".")).toHaveLength(3);
    expect(new Date(assertion_expires).getTime() - before).toBeGreaterThan(364 * DAY);
    expect(account).toMatchObject({ id: registration_id, state: "unclaimed", claimed: false, claimed_by: null });
    expect(account.claim_url).toMatch(new RegExp(`^${BASE}/claim/ct_`));
    const freeze = new Date(account.freeze_at).getTime();
    expect(freeze - before).toBeGreaterThanOrEqual(72 * HOUR - 1000);
    expect(freeze - before).toBeLessThanOrEqual(72 * HOUR + 5000);
    expect(new Date(account.delete_at).getTime() - freeze).toBe(30 * DAY);
    expect(capabilities).toEqual(expect.arrayContaining([
      { capability: "save_material", granted: true },
      { capability: "save_drafts", granted: true },
      { capability: "read_buffer", granted: false, reason: "requires_claim" },
    ]));
    expect(capabilities.map((c) => c.capability)).not.toContain("admin");
    // No person is made: the agent lives only in its own tables.
    expect(await count(`"user"`)).toBe(usersBefore);
    const [row] = (await pg.query<Row>(`select owner_email_hint, ip_hash, tool, label from qp_agent_registration where id = $1`, [registration_id])).rows;
    expect(row).toMatchObject({ owner_email_hint: "ada@x.test", tool: "test-agent", label: "Ada's laptop" });
    expect(row.ip_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("returns the same claim link in later replies, rebuilt rather than stored", async () => {
    const a = await newAgent();
    const r = await call(accountRoute, "/v1/agent/account", a.token);
    expect(r.json.account.claim_url).toBe(a.claimUrl);
    const mac = a.claimUrl.split(".").pop()!;
    const stored = JSON.stringify((await pg.query(`select * from qp_claim_ticket where registration_id = $1`, [a.id])).rows);
    expect(stored).not.toContain(mac);
  });

  it("refuses what is not an anonymous registration, and cleans the label to plain text", async () => {
    expect((await register({})).json.error).toBe("invalid_request");
    expect((await register({ type: "service_auth" })).json.error).toBe("identity_type_not_enabled");
    expect((await register({ type: "anonymous", login_hint: "not an address" })).json.error).toBe("invalid_login_hint");
    expect((await register({ type: "anonymous", tool: "Has Capitals" })).json.error).toBe("invalid_request");
    const r = await register({ type: "anonymous", label: "<a href=x>click</a>\n" + "y".repeat(80) });
    const [row] = (await pg.query<Row>(`select label from qp_agent_registration where id = $1`, [r.json.registration_id])).rows;
    expect(row.label).not.toMatch(/[<>\n]/);
    expect(row.label!.length).toBeLessThanOrEqual(40);
  });

  it("holds the per-address limit: three a day, the fourth gets registration_limited with retry_after", async () => {
    const from = nextIp();
    for (let i = 0; i < 3; i++) expect((await register(undefined, from)).status).toBe(201);
    const fourth = await register(undefined, from);
    expect(fourth.status).toBe(429);
    expect(fourth.json).toMatchObject({ error: "registration_limited", retryable: true, account: null });
    expect(fourth.json.retry_after).toBeGreaterThan(0);
    expect(fourth.headers.get("retry-after")).toBe(String(fourth.json.retry_after));
    // Control: another address is not affected.
    expect((await register(undefined, nextIp())).status).toBe(201);
  });

  it("does not count a malformed request against the address", async () => {
    const from = nextIp();
    for (let i = 0; i < 5; i++) await register({ type: "nope" }, from);
    expect((await register(undefined, from)).status).toBe(201);
  });
});

describe("the operator's switch", () => {
  it("is off on a fresh server until the admin turns it on", async () => {
    vi.stubEnv("AGENT_SIGNUP", "");
    clearOperatorSettingsCache();
    expect((await register()).json).toMatchObject({ error: "registration_disabled" });
  });

  it("answers registration_disabled when agent_signup is off, and agents already signed up keep working", async () => {
    const before = await newAgent();
    vi.stubEnv("AGENT_SIGNUP", "off");
    clearOperatorSettingsCache();
    const r = await register();
    expect(r.status).toBe(403);
    expect(r.json).toMatchObject({ error: "registration_disabled", next: { action: "ask_person" }, account: null });
    expect((await trade(before.assertion)).status).toBe(200);
    expect((await call(accountRoute, "/v1/agent/account", before.token)).status).toBe(200);
  });

  it("can be switched off and on from a connected AI app through the admin door", async () => {
    vi.stubEnv("SETTINGS_KEY", "k".repeat(64));
    const now = new Date().toISOString();
    await pg.query(`insert into oauth_client (id, client_id, redirect_uris, created_at, updated_at) values ('app-admin', 'app-admin', '{https://x/cb}', $1, $1)`, [now]);
    await pg.query(`insert into oauth_consent (id, client_id, user_id, scopes, created_at, updated_at) values ('c-admin', 'app-admin', 'admin1', '{openid}', $1, $1)`, [now]);
    await pg.query(`insert into qp_app_admin_grant (user_id, consent_id, granted_by) values ('admin1', 'c-admin', 'admin1')`);
    const principal = { via: "mcp" as const, userId: "admin1", clientId: "app-admin" };
    const set = async (value: string) => {
      const out = await invokeAdminOperation(principal, "admin.settings.set", { key: "agent_signup", value });
      expect(out.ok).toBe(true);
      forgetSettings();
      clearOperatorSettingsCache();
    };
    await set("off");
    expect((await register()).json.error).toBe("registration_disabled");
    await set("on");
    expect((await register()).status).toBe(201);
    const bad = await invokeAdminOperation(principal, "admin.settings.set", { key: "agent_signup", value: "maybe" });
    expect(bad.ok).toBe(false);
    await pg.query(`delete from operator_settings where key = 'agent_signup'`);
    forgetSettings();
    vi.stubEnv("SETTINGS_KEY", "");
  });
});

describe("trading the assertion", () => {
  it("returns a one-hour bearer token with no refresh token, and the account block", async () => {
    const r = await register();
    const t = await trade(r.json.identity_assertion, { resource: `${BASE}/v1/` });
    expect(t.status).toBe(200);
    expect(t.json).toMatchObject({ token_type: "Bearer", expires_in: 3600, account: { id: r.json.registration_id, state: "unclaimed" } });
    expect(t.json).not.toHaveProperty("refresh_token");
  });

  it("refuses the wrong grant, the wrong resource, and anything that is not our assertion", async () => {
    const r = await register();
    const wrongGrant = await tokenRoute(new Request(`${BASE}/v1/oauth2/token`, { method: "POST", body: new URLSearchParams({ grant_type: "client_credentials" }) }));
    expect((await wrongGrant.json()).error).toBe("unsupported_grant_type");
    expect((await trade(r.json.identity_assertion, { resource: "https://elsewhere.example/" })).json.error).toBe("invalid_target");
    expect((await trade("not.a.jwt")).json).toMatchObject({ error: "invalid_grant", next: { action: "drop_credential" } });
    // An access token is not an assertion, and an assertion is not an access token.
    const t = await trade(r.json.identity_assertion);
    expect((await trade(t.json.access_token)).json.error).toBe("invalid_grant");
    expect((await call(accountRoute, "/v1/agent/account", r.json.identity_assertion)).json.error).toBe("unauthorized");
  });

  it("refuses a replaced assertion (its jti is no longer the row's) with invalid_grant", async () => {
    const a = await newAgent();
    await pg.query(`update qp_agent_registration set assertion_jti = 'replaced' where id = $1`, [a.id]);
    expect((await trade(a.assertion)).json.error).toBe("invalid_grant");
  });

  it("refuses a revoked agent with agent_revoked, on the trade and on every call", async () => {
    const a = await newAgent();
    await pg.query(`update qp_agent_registration set revoked_at = now(), revoked_reason = 'self' where id = $1`, [a.id]);
    expect((await trade(a.assertion)).json).toMatchObject({ error: "agent_revoked", next: { action: "drop_credential" } });
    expect((await call(accountRoute, "/v1/agent/account", a.token)).json.error).toBe("agent_revoked");
  });
});

describe("the account's clock", () => {
  it("frozen: still trades, reads and can be claimed, but cannot save", async () => {
    const a = await newAgent();
    await call(materialRoute.POST, "/v1/agent/material", a.token, { title: "Before", text: "Saved while active." });
    await backdate(a.id, 73 * HOUR);
    const t = await trade(a.assertion);
    expect(t.status).toBe(200);
    expect(t.json.account.state).toBe("frozen");
    const read = await call(materialRoute.GET, "/v1/agent/material", t.json.access_token);
    expect(read.status).toBe(200);
    expect(read.json.material.map((m) => m.title)).toEqual(["Before"]);
    expect((await call(accountRoute, "/v1/agent/account", t.json.access_token)).json.account.state).toBe("frozen");
    for (const [route, path, body] of [[materialRoute.POST, "/v1/agent/material", { title: "x", text: "y" }], [draftsRoute.POST, "/v1/agent/drafts", { title: "x", text: "y" }]] as const) {
      const w = await call(route, path, t.json.access_token, body);
      expect(w.status).toBe(403);
      expect(w.json).toMatchObject({ error: "account_frozen", next: { action: "show_claim_url", url: a.claimUrl } });
    }
    expect((await acceptClaim(server, tokenOf(a.claimUrl), "u1")).ok).toBe(true);
    // Claimed, it is active again and saves.
    expect((await call(materialRoute.POST, "/v1/agent/material", t.json.access_token, { title: "After", text: "Saved after the claim." })).status).toBe(201);
  });

  it("deleted: the trade and every call answer account_deleted, the claim page says it is gone", async () => {
    const a = await newAgent();
    await backdate(a.id, 72 * HOUR + 30 * DAY + HOUR);
    expect((await trade(a.assertion)).json).toMatchObject({ error: "account_deleted", next: { action: "drop_credential" }, account: { state: "deleted", claim_url: null } });
    expect((await call(accountRoute, "/v1/agent/account", a.token)).json.error).toBe("account_deleted");
    expect((await claimView(server, tokenOf(a.claimUrl), { userId: "u1", email: "ada@x.test" })).state).toBe("account_deleted");
    expect((await acceptClaim(server, tokenOf(a.claimUrl), "u1"))).toEqual({ ok: false, reason: "account_deleted" });
    // Once the cleanup removes the row, the answer is the same.
    await pg.query(`delete from qp_agent_registration where id = $1`, [a.id]);
    expect((await trade(a.assertion)).json.error).toBe("account_deleted");
  });
});
