/**
 * @fileoverview Agent sign-up end to end on PGlite with every migration: the agent's own tools, what an unclaimed agent cannot do, the link claim and /auth.md.
 * The real /v1 routes, the real Better Auth instance signing on the same database, and the real claim transaction;
 * nothing about tokens or the database is stubbed. Split from agent-signup.test.ts; shared setup is
 * src/test/agent-signup-setup.ts.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { BASE, acceptClaim, accountRoute, authMdRoute, call, catchAll, claimView, count, draftsRoute, materialRoute, newAgent, pg, seedPeople, server, signupOn, tokenOf, type Row } from "@/test/agent-signup-setup";

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

describe("the agent's own tools", () => {
  it("saves and lists material and drafts, and the same item twice keeps one", async () => {
    const a = await newAgent();
    const m = await call(materialRoute.POST, "/v1/agent/material", a.token, { title: "Launch notes", text: "We ship on Friday.", link: "https://example.com/notes" });
    expect(m.status).toBe(201);
    expect(m.json.account.id).toBe(a.id);
    await call(materialRoute.POST, "/v1/agent/material", a.token, { title: "Launch notes", text: "We ship on Friday.", link: "https://example.com/notes" });
    await call(draftsRoute.POST, "/v1/agent/drafts", a.token, { title: "Friday post", text: "It ships Friday." });
    expect((await call(materialRoute.GET, "/v1/agent/material", a.token)).json.material).toHaveLength(1);
    expect((await call(draftsRoute.GET, "/v1/agent/drafts", a.token)).json.drafts.map((d) => d.title)).toEqual(["Friday post"]);
  });

  it("refuses a body that does not fit, in the flat error shape with the account", async () => {
    const a = await newAgent();
    const r = await call(materialRoute.POST, "/v1/agent/material", a.token, { title: "x", text: "y", registration_id: "reg_other" });
    expect(r.json).toMatchObject({ error: "invalid_request", account: { id: a.id } });
    expect((await call(draftsRoute.POST, "/v1/agent/drafts", a.token, { title: "", text: "" })).json.error).toBe("invalid_request");
  });

  it("keeps one agent out of another's work", async () => {
    const a = await newAgent();
    const b = await newAgent();
    await call(materialRoute.POST, "/v1/agent/material", a.token, { title: "A's secret", text: "Only for A." });
    await call(draftsRoute.POST, "/v1/agent/drafts", a.token, { title: "A's draft", text: "Only for A." });
    expect((await call(materialRoute.GET, "/v1/agent/material", b.token)).json.material).toEqual([]);
    expect((await call(draftsRoute.GET, "/v1/agent/drafts", b.token)).json.drafts).toEqual([]);
    // Control: A sees its own.
    expect((await call(materialRoute.GET, "/v1/agent/material", a.token)).json.material).toHaveLength(1);
  });

  it("answers unauthorized without a token", async () => {
    const res = await accountRoute(new Request(`${BASE}/v1/agent/account`));
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: "unauthorized", account: null });
  });
});

describe("what an unclaimed agent cannot do", () => {
  // There is no tool for any external action: the only /v1 routes are these, and every other /v1 address answers
  // not_found in the flat shape. The connector refusing the agent's token is proven in api/mcp/agent-token.test.ts.
  it("has exactly these /v1 routes, none of which reaches Buffer, a network, the AI budget or admin", () => {
    const root = join(__dirname, "../../app/v1");
    const routes = (function walk(dir: string): string[] {
      return readdirSync(dir, { withFileTypes: true }).flatMap((e) => { if (e.isDirectory()) return walk(join(dir, e.name)); return e.name === "route.ts" ? [relative(root, dir)] : []; });
    })(root).sort();
    expect(routes).toEqual(["[...rest]", "agent/account", "agent/drafts", "agent/identity", "agent/material", "oauth2/token"]);
    for (const r of routes) {
      const text = readFileSync(join(root, r, "route.ts"), "utf8");
      expect({ route: r, found: /buffer\/|bufferAccessToken|echo|direct-post|judge-model|admin-operations|ai-allowance/.exec(text)?.[0] ?? null }).toEqual({ route: r, found: null });
    }
  });

  it.each(["GET", "POST", "PUT", "PATCH", "DELETE"] as const)("any other /v1 address answers not_found to %s", async (method) => {
    const res = await catchAll[method]();
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: "not_found", account: null, next: { action: "fix_request" } });
  });

  it("holds only the two starting grants, and the table refuses any other capability", async () => {
    const a = await newAgent();
    const rows = (await pg.query<Row>(`select capability from qp_agent_grant where registration_id = $1 order by 1`, [a.id])).rows;
    expect(rows.map((r) => r.capability)).toEqual(["save_drafts", "save_material"]);
    await expect(pg.query(`insert into qp_agent_grant (registration_id, capability, source) values ($1, 'admin', 'claim')`, [a.id])).rejects.toThrow('violates check constraint "qp_agent_grant_capability"');
  });
});

describe("the link claim", () => {
  it("shows a signed-in person the agent's label and saved work, then attaches the work to them", async () => {
    const a = await newAgent({ type: "anonymous", tool: "test-agent", label: "Ada's laptop", login_hint: "someone@else.test" });
    await call(materialRoute.POST, "/v1/agent/material", a.token, { title: "Research", text: "Three sources agree." });
    await call(draftsRoute.POST, "/v1/agent/drafts", a.token, { title: "Thread", text: "A short thread." });

    const view = await claimView(server, tokenOf(a.claimUrl), { userId: "u1", email: "ada@x.test" });
    expect(view).toMatchObject({ state: "open", label: "Ada's laptop", tool: "test-agent", namedAddress: "s***@e***.test", addressDiffers: true });
    if (view.state !== "open") throw new Error("not open");
    expect(view.material.map((m) => m.title)).toEqual(["Research"]);
    expect(view.drafts.map((d) => d.title)).toEqual(["Thread"]);
    expect(view).toMatchObject({ materialCount: 1, draftCount: 1 });

    const result = await acceptClaim(server, tokenOf(a.claimUrl), "u1");
    expect(result).toEqual({ ok: true, registrationId: a.id, copiedMaterial: 1, drafts: 1 });
    const [reg] = (await pg.query<Row>(`select user_id, claimed_at from qp_agent_registration where id = $1`, [a.id])).rows;
    expect(reg.user_id).toBe("u1");
    expect(reg.claimed_at).not.toBeNull();
    expect((await pg.query(`select title from qp_material where user_id = 'u1' and title = 'Research'`)).rows).toHaveLength(1);
    expect((await pg.query<Row>(`select state, claimed_by from qp_claim_ticket where registration_id = $1`, [a.id])).rows).toEqual([{ state: "used", claimed_by: "u1" }]);

    // The agent learns it from its next reply, and keeps working.
    const next = await call(accountRoute, "/v1/agent/account", a.token);
    expect(next.json.account).toMatchObject({ state: "claimed", claimed: true, claim_url: null, freeze_at: null, delete_at: null, claimed_by: "a***@x*.test" });
    expect((await claimView(server, tokenOf(a.claimUrl), { userId: "u1", email: "ada@x.test" })).state).toBe("yours");
    expect((await claimView(server, tokenOf(a.claimUrl), { userId: "u2", email: "bo@x.test" })).state).toBe("already_claimed");
  });

  it("lets exactly one of two accepts at the same moment win; the other is already_claimed", async () => {
    const a = await newAgent();
    const t = tokenOf(a.claimUrl);
    // PGlite has one connection, so these two transactions run one after the other. That proves the re-check under
    // the lock and the guarded update decide the loser; Postgres's row lock is what makes them wait in production.
    const results = await Promise.all([acceptClaim(server, t, "u1"), acceptClaim(server, t, "u2")]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.find((r) => !r.ok)).toEqual({ ok: false, reason: "already_claimed" });
    const [reg] = (await pg.query<Row>(`select user_id from qp_agent_registration where id = $1`, [a.id])).rows;
    expect(reg.user_id).toBe(results[0].ok ? "u1" : "u2");
    expect(await acceptClaim(server, t, "u1")).toEqual({ ok: false, reason: "already_claimed" });
  });

  it("voids the competing tickets", async () => {
    const a = await newAgent();
    await pg.query(`insert into qp_claim_ticket (id, registration_id, route) values ('tk_other', $1, 'computer')`, [a.id]);
    expect((await acceptClaim(server, tokenOf(a.claimUrl), "u1")).ok).toBe(true);
    expect((await pg.query<Row>(`select state from qp_claim_ticket where id = 'tk_other'`)).rows[0].state).toBe("void");
  });

  it("refuses a link with a wrong mac, a mangled token, and one for another account", async () => {
    const a = await newAgent();
    const b = await newAgent();
    const t = tokenOf(a.claimUrl);
    const forged = t.slice(0, -3) + (t.endsWith("AAA") ? "BBB" : "AAA");
    expect(await acceptClaim(server, forged, "u1")).toEqual({ ok: false, reason: "ticket_unknown" });
    expect(await acceptClaim(server, "ct_nothing", "u1")).toEqual({ ok: false, reason: "ticket_unknown" });
    const [aTicket] = t.slice(3).split(".");
    const swapped = tokenOf(b.claimUrl).replace(/^ct_[^.]+/, `ct_${aTicket}`);
    expect(await acceptClaim(server, swapped, "u1")).toEqual({ ok: false, reason: "ticket_unknown" });
    expect((await pg.query<Row>(`select user_id from qp_agent_registration where id in ($1, $2)`, [a.id, b.id])).rows.every((r) => r.user_id === null)).toBe(true);
  });

  it("never creates an admin grant, a connector approval, a person or a session", async () => {
    // Rows already present, so "unchanged" cannot pass as 0 = 0.
    const now = new Date().toISOString();
    await pg.query(`insert into oauth_client (id, client_id, redirect_uris, created_at, updated_at) values ('app-seed', 'app-seed', '{https://x/cb}', $1, $1) on conflict do nothing`, [now]);
    await pg.query(`insert into oauth_consent (id, client_id, user_id, scopes, created_at, updated_at) values ('c-seed', 'app-seed', 'admin1', '{openid}', $1, $1) on conflict do nothing`, [now]);
    await pg.query(`insert into qp_app_admin_grant (user_id, consent_id, granted_by) values ('admin1', 'c-seed', 'admin1') on conflict do nothing`);
    const tables = ["qp_app_admin_grant", "oauth_consent", `"user"`, "session", "account", "oauth_client"];
    const before = await Promise.all(tables.map(count));
    expect(before[0]).toBeGreaterThan(0);
    expect(before[1]).toBeGreaterThan(0);

    // Claimed by the admin themselves, the case most likely to leak admin access.
    const a = await newAgent();
    expect((await acceptClaim(server, tokenOf(a.claimUrl), "admin1")).ok).toBe(true);
    expect(await Promise.all(tables.map(count))).toEqual(before);
    const grants = (await pg.query<Row>(`select capability, source, granted_by from qp_agent_grant where registration_id = $1 order by 1`, [a.id])).rows;
    expect(grants).toEqual([
      { capability: "save_drafts", source: "claim", granted_by: "admin1" },
      { capability: "save_material", source: "claim", granted_by: "admin1" },
    ]);
  });

  it("goes with the person: deleting them deletes the agents they claimed and their work", async () => {
    await pg.query(`insert into "user" (id, name, email) values ('u-gone', 'Gone', 'gone@x.test')`);
    const a = await newAgent();
    await call(draftsRoute.POST, "/v1/agent/drafts", a.token, { title: "d", text: "t" });
    await acceptClaim(server, tokenOf(a.claimUrl), "u-gone");
    await pg.query(`delete from "user" where id = 'u-gone'`);
    expect((await pg.query(`select 1 from qp_agent_registration where id = $1`, [a.id])).rows).toHaveLength(0);
    expect((await pg.query(`select 1 from qp_agent_artifact where registration_id = $1`, [a.id])).rows).toHaveLength(0);
  });
});

describe("/auth.md", () => {
  it("is served as markdown, written for this server's address", async () => {
    const res = await authMdRoute(new Request(`${BASE}/auth.md`));
    expect(res.headers.get("content-type")).toMatch(/^text\/markdown/);
    const text = await res.text();
    expect(text).toContain(`POST ${BASE}/v1/agent/identity`);
    expect(text).toContain(`POST ${BASE}/v1/oauth2/token`);
    // Every call an agent can make is named, so a reader of this file alone can do the whole job.
    for (const call of ["GET  https://qp.example/v1/agent/account", "POST https://qp.example/v1/agent/material", "GET  https://qp.example/v1/agent/material", "POST https://qp.example/v1/agent/drafts", "GET  https://qp.example/v1/agent/drafts"]) expect(text).toContain(call);
  });
});
