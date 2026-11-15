/**
 * @fileoverview The admin tools end to end through the real MCP route on PGlite with the real migrations: only the
 * token check is stubbed (it hands the route the token's user and app). Proves the route binds the right person and
 * app: an admin's app with admin access works; the same admin's other app, a deleted approval and a removed role are
 * refused, and a non-admin never sees the tools.
 */
import { migratedPglite } from "@/test/migrated-pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// The app checks for a database by this variable; the calls themselves go to PGlite through the mocked db().
vi.stubEnv("DATABASE_URL", "postgres://test@localhost/unused");
const pg = await migratedPglite();
const testDb = drizzle(pg, { schema: { ...(await import("@/db/schema")), ...(await import("@/db/auth-schema")) } });
vi.mock("@/db", () => ({ db: () => testDb }));
vi.mock("@/lib/auth", () => ({ getAuth: async () => ({ $context: Promise.resolve({ baseURL: "https://app.example/api/auth" }) }), mcpResource: (url: string) => `${url}/api/mcp` }));
// The token check alone is stubbed: the test says which person and which app the token belongs to.
vi.mock("@better-auth/mcp", () => ({
  requireMcpAuth: (_auth: unknown, handler: (req: Request, claims: { sub?: string; azp: string }) => Promise<Response>) => (req: Request) =>
    handler(req, { sub: req.headers.get("x-test-user") ?? undefined, azp: req.headers.get("x-test-app") ?? "" }),
}));

const { POST } = await import("./route");

/** One JSON-RPC call to the route as this person and app; returns the parsed result. */
async function call(user: string, app: string, method: string, params: Record<string, unknown> = {}) {
  const res = await POST(new Request("https://app.example/api/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "x-test-user": user, "x-test-app": app },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  }));
  const body = await res.text();
  const json = JSON.parse(body.trim().startsWith("{") ? body : body.split("\n").find((l) => l.startsWith("data:"))!.slice(5));
  return { status: res.status, json };
}
const toolNames = async (user: string, app: string) => ((await call(user, app, "tools/list")).json.result?.tools ?? []).map((t: { name: string }) => t.name);
const callTool = async (user: string, app: string, name: string, args: Record<string, unknown> = {}) => (await call(user, app, "tools/call", { name, arguments: args })).json.result;

const now = new Date().toISOString();
beforeAll(async () => {
  await pg.query(`insert into "user" (id, name, email, role) values ('admin1', 'Ada', 'ada@x', 'admin'), ('user1', 'Bo', 'bo@x', 'user')`);
  for (const [client, owner] of [["app-granted", "admin1"], ["app-other", "admin1"], ["app-user", "user1"]]) {
    await pg.query(`insert into oauth_client (id, client_id, redirect_uris, created_at, updated_at) values ($1, $1, '{https://x/cb}', $2, $2)`, [client, now]);
    await pg.query(`insert into oauth_consent (id, client_id, user_id, scopes, created_at, updated_at) values ($1, $2, $3, '{openid}', $4, $4)`, [`c-${client}`, client, owner, now]);
  }
  await pg.query(`insert into qp_app_admin_grant (user_id, consent_id, granted_by) values ('admin1', 'c-app-granted', 'admin1')`);
});
afterAll(async () => { await pg.close(); });

describe("admin tools through the MCP route", () => {
  it("lists the admin tools for an admin and runs one for the app given admin access", async () => {
    expect(await toolNames("admin1", "app-granted")).toContain("admin_settings_list");
    const r = await callTool("admin1", "app-granted", "admin_settings_list");
    expect(r.isError).toBeFalsy();
  });

  it("never shows the admin tools to the same admin's other app, and a direct call to one fails", async () => {
    expect(await toolNames("admin1", "app-other")).not.toContain("admin_settings_list");
    const r = await call("admin1", "app-other", "tools/call", { name: "admin_settings_list", arguments: {} });
    expect(r.json.result?.isError === true || Boolean(r.json.error)).toBe(true);
    expect(JSON.stringify(r.json)).not.toMatch(/"rows"/);
  });

  it("never shows the admin tools to someone who is not an admin", async () => {
    expect(await toolNames("user1", "app-user")).not.toContain("admin_settings_list");
  });

  it("records each admin call with the app it came from", async () => {
    const rows = (await pg.query<{ via: string; operation: string }>(`select via, operation from qp_admin_audit where operation = 'admin.settings.list'`)).rows;
    expect(rows.map((r) => r.via)).toEqual(expect.arrayContaining([expect.stringContaining("app-granted")]));
  });

  it("refuses once the app's approval is deleted, and its admin access goes with it", async () => {
    await pg.query(`delete from oauth_consent where id = 'c-app-granted'`);
    expect((await pg.query(`select 1 from qp_app_admin_grant where consent_id = 'c-app-granted'`)).rows).toHaveLength(0);
    const r = await call("admin1", "app-granted", "tools/call", { name: "admin_settings_list", arguments: {} });
    // With no approval the route refuses before any tool runs, or the door refuses the tool: either way, no admin data.
    expect(r.status === 401 || r.json.result?.isError === true || r.json.error).toBeTruthy();
  });

  it("drops the admin tools on the next call once the role is removed", async () => {
    await pg.query(`insert into oauth_consent (id, client_id, user_id, scopes, created_at, updated_at) values ('c-app-granted-2', 'app-granted', 'admin1', '{openid}', $1, $1)`, [now]);
    await pg.query(`insert into qp_app_admin_grant (user_id, consent_id, granted_by) values ('admin1', 'c-app-granted-2', 'admin1')`);
    expect(await toolNames("admin1", "app-granted")).toContain("admin_settings_list");
    await pg.query(`update "user" set role = 'user' where id = 'admin1'`);
    expect(await toolNames("admin1", "app-granted")).not.toContain("admin_settings_list");
  });
});
