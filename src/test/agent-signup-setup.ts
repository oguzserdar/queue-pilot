/**
 * @fileoverview Shared setup for the agent-signup-*.test.ts files: the real /v1 routes over the database in
 * agent-signup-db.ts, the real claim code, and the helpers that register an agent and call it. Each test file
 * mocks "@/db" and "@/lib/auth" itself (a mock is only hoisted in the test file), seeds the people and turns sign-up on.
 */
import { expect, vi } from "vitest";
import { BASE, pg } from "./agent-signup-db";

export { BASE, pg };

export const { POST: identityRoute } = await import("@/app/v1/agent/identity/route");
export const { POST: tokenRoute } = await import("@/app/v1/oauth2/token/route");
export const { GET: accountRoute } = await import("@/app/v1/agent/account/route");
export const materialRoute = await import("@/app/v1/agent/material/route");
export const draftsRoute = await import("@/app/v1/agent/drafts/route");
export const catchAll = await import("@/app/v1/[...rest]/route");
export const { GET: authMdRoute } = await import("@/app/auth.md/route");
export const { acceptClaim, claimView } = await import("@/lib/agent-signup/claim");
export const { agentServer } = await import("@/lib/agent-signup/server");
export const { clearOperatorSettingsCache } = await import("@/lib/env");
export const { forgetSettings } = await import("@/lib/db");
export const { invokeAdminOperation } = await import("@/lib/admin-operations");
export const server = (await agentServer())!;

let ip = 0;
export const nextIp = () => `198.51.${Math.floor(++ip / 250)}.${ip % 250}`;
export const HOUR = 60 * 60 * 1000;
export const DAY = 24 * HOUR;

/**
 * The agent API's JSON answers, with the fields these tests read. Which fields an answer carries depends on the route
 * and the outcome; a test that reads one that is absent gets undefined and fails its assertion.
 */
export type Json = {
  error: string; identity_assertion: string; assertion_expires: string; access_token: string; registration_id: string; retry_after: number;
  account: { id: string; state: string; claim_url: string; freeze_at: string; delete_at: string; [field: string]: unknown };
  material: { title: string }[]; drafts: { title: string }[]; capabilities: { capability: string }[]; [field: string]: unknown;
};
/** A row read back with raw SQL; every column these tests read is text. */
export type Row = Record<string, string | null>;

export async function register(body: unknown = { type: "anonymous", tool: "test-agent", label: "Ada's laptop" }, from = nextIp()) {
  const res = await identityRoute(new Request(`${BASE}/v1/agent/identity`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": from },
    body: JSON.stringify(body),
  }));
  return { status: res.status, headers: res.headers, json: (await res.json()) as Json };
}

export async function trade(assertion: string, extra: Record<string, string> = {}) {
  const form = new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion, ...extra });
  const res = await tokenRoute(new Request(`${BASE}/v1/oauth2/token`, { method: "POST", headers: { "x-forwarded-for": nextIp() }, body: form }));
  return { status: res.status, json: (await res.json()) as Json };
}

export async function call(handler: (r: Request) => Promise<Response>, path: string, token: string, body?: unknown) {
  const res = await handler(new Request(`${BASE}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }));
  return { status: res.status, json: (await res.json()) as Json };
}

/** A registered agent with a working access token. */
export async function newAgent(body?: unknown) {
  const r = await register(body);
  expect(r.status).toBe(201);
  const t = await trade(r.json.identity_assertion);
  expect(t.status).toBe(200);
  return { id: r.json.registration_id, assertion: r.json.identity_assertion, token: t.json.access_token, claimUrl: r.json.account.claim_url };
}

export const tokenOf = (claimUrl: string) => claimUrl.slice(`${BASE}/claim/`.length);
export const count = async (table: string) => Number((await pg.query<{ n: string }>(`select count(*)::text as n from ${table}`)).rows[0].n);
export const backdate = (id: string, ms: number) => pg.query(`update qp_agent_registration set created_at = now() - ($2 || ' milliseconds')::interval where id = $1`, [id, String(ms)]);

/** The people the sign-up tests act for: two users and an admin. */
export async function seedPeople(): Promise<void> {
  await pg.query(`insert into "user" (id, name, email, role) values ('u1', 'Ada', 'ada@x.test', 'user'), ('u2', 'Bo', 'bo@x.test', 'user'), ('admin1', 'Cy', 'cy@x.test', 'admin')`);
}

/** Sign-up is off on a fresh server; these tests run with the admin having turned it on. */
export function signupOn(): void {
  vi.stubEnv("AGENT_SIGNUP", "on");
  clearOperatorSettingsCache();
}
