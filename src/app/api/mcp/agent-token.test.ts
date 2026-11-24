/**
 * @fileoverview A signed-up agent's access token is refused by every tool on the people's connector (/api/mcp).
 *
 * Nothing about tokens is stubbed here: the real Better Auth instance signs on PGlite with every migration, the real
 * requireMcpAuth verifies, and the route runs as shipped. The one stand-in is the network: the verifier fetches the
 * public keys from this site's /api/auth/jwks, so that fetch is answered by the same Better Auth instance.
 *
 * The control proves the verifier really runs: a token shaped like a person's connector token (issuer /api/auth,
 * audience /api/mcp) gets through and lists the tools. Those tools, listed live for an admin whose app has admin
 * access, are the names the agent's token is then refused on, one call each.
 */
import { migratedPglite } from "@/test/migrated-pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const BASE = "https://qp.example";
vi.stubEnv("DATABASE_URL", "postgres://test@localhost/unused");
vi.stubEnv("AGENT_SIGNUP", "on");
// Each call comes from its own address, so the per-address limit on refused calls never answers in place of the check.
vi.stubEnv("TRUSTED_PROXY_HOP_COUNT", "1");
let caller = 0;
const pg = await migratedPglite();
const schema = { ...(await import("@/db/schema")), ...(await import("@/db/auth-schema")) };
const testDb = drizzle(pg, { schema });
vi.mock("@/db", () => ({ db: () => testDb, schema }));
vi.mock("@/lib/auth", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/auth")>();
  const auth = real.buildAuth({ clientId: "test", secret: "test-secret-".padEnd(40, "x"), baseURL: BASE });
  return { ...real, getAuth: async () => auth };
});

const { getAuth } = await import("@/lib/auth");
const auth = (await getAuth())!;
const realFetch = globalThis.fetch;
vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = input instanceof Request ? input.url : String(input);
  return url.startsWith(`${BASE}/api/auth/`) ? auth.handler(new Request(url, init)) : realFetch(input, init);
});

const { POST: mcp } = await import("./route");
const { POST: register } = await import("@/app/v1/agent/identity/route");
const { POST: tokenRoute } = await import("@/app/v1/oauth2/token/route");

async function rpc(bearer: string, method: string, params: Record<string, unknown> = {}) {
  const res = await mcp(new Request(`${BASE}/api/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${bearer}`, "x-forwarded-for": `10.9.${Math.floor(++caller / 250)}.${caller % 250}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  }));
  const text = await res.text();
  const line = text.trim().startsWith("{") ? text : text.split("\n").find((l) => l.startsWith("data:"))?.slice(5) ?? "{}";
  return { status: res.status, json: JSON.parse(line) as { result?: { tools?: { name: string }[] }; error?: unknown } };
}

const now = new Date().toISOString();
let agentToken = "";
let agentAssertion = "";
let personToken = "";

beforeAll(async () => {
  await pg.query(`insert into "user" (id, name, email, role) values ('admin1', 'Ada', 'ada@x.test', 'admin')`);
  await pg.query(`insert into oauth_client (id, client_id, redirect_uris, created_at, updated_at) values ('app-granted', 'app-granted', '{https://x/cb}', $1, $1)`, [now]);
  await pg.query(`insert into oauth_consent (id, client_id, user_id, scopes, created_at, updated_at) values ('c1', 'app-granted', 'admin1', '{openid}', $1, $1)`, [now]);
  await pg.query(`insert into qp_app_admin_grant (user_id, consent_id, granted_by) values ('admin1', 'c1', 'admin1')`);

  const reg = await (await register(new Request(`${BASE}/v1/agent/identity`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: "anonymous", tool: "test-agent" }) }))).json();
  agentAssertion = reg.identity_assertion;
  const form = new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: agentAssertion });
  agentToken = (await (await tokenRoute(new Request(`${BASE}/v1/oauth2/token`, { method: "POST", body: form }))).json()).access_token;

  // Shaped like the connector's own access tokens: issued by /api/auth, for /api/mcp, naming a person and their app.
  const iat = Math.floor(Date.now() / 1000);
  personToken = (await auth.api.signJWT({ body: { payload: { iss: `${BASE}/api/auth`, aud: `${BASE}/api/mcp`, sub: "admin1", azp: "app-granted", scope: "openid", iat, exp: iat + 600 } } })).token;
});
afterAll(async () => { await pg.close(); });

describe("the people's connector refuses a signed-up agent", () => {
  let names: string[] = [];

  it("control: a person's connector token passes the real verifier and lists every tool, admin tools included", async () => {
    const r = await rpc(personToken, "tools/list");
    expect(r.status).toBe(200);
    names = (r.json.result?.tools ?? []).map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(["save_drafts", "approve_drafts", "add_material", "admin_settings_list"]));
    expect(names.length).toBeGreaterThanOrEqual(40);
  });

  it("control: the agent really holds a working access token", () => {
    expect(agentToken.split(".")).toHaveLength(3);
  });

  it("refuses the agent's token on tools/list", async () => {
    const r = await rpc(agentToken, "tools/list");
    expect(r.status).toBe(401);
    expect(r.json.result).toBeUndefined();
  });

  it("refuses the agent's identity assertion too", async () => {
    const r = await rpc(agentAssertion, "tools/list");
    expect(r.status).toBe(401);
    expect(r.json.result).toBeUndefined();
  });

  it("refuses the agent's token on every tool, by name", async () => {
    expect(names.length).toBeGreaterThan(0);
    const allowed: string[] = [];
    for (const name of names) {
      const r = await rpc(agentToken, "tools/call", { name, arguments: {} });
      if (r.status !== 401 || r.json.result !== undefined) allowed.push(name);
    }
    expect(allowed).toEqual([]);
  });

  it("never treats a registration id as a person, even in a token the verifier accepts", async () => {
    const iat = Math.floor(Date.now() / 1000);
    const forged = (await auth.api.signJWT({ body: { payload: { iss: `${BASE}/api/auth`, aud: `${BASE}/api/mcp`, sub: "reg_someagent", azp: "app-granted", scope: "openid", iat, exp: iat + 600 } } })).token;
    const r = await rpc(forged, "tools/call", { name: "add_material", arguments: { title: "x", text: "y" } });
    expect(r.status).toBe(401);
    expect(r.json.result).toBeUndefined();
  });
});
