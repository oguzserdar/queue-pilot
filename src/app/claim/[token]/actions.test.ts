/**
 * @fileoverview The claim page's Accept action and its sign-in return, on PGlite with every migration and the real
 * Better Auth instance. Only the session read is replaced: the test says who is signed in, the way a session cookie
 * would. Proves the person comes from the session, never from the form: signed out attaches nothing, signed in
 * attaches to that person. Also proves Better Auth keeps the claim page as the place to come back to after signing
 * in with Buffer, so a person who opens a claim link signed out returns to it.
 */
import { migratedPglite } from "@/test/migrated-pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const BASE = "https://qp.example";
vi.stubEnv("DATABASE_URL", "postgres://test@localhost/unused");
vi.stubEnv("AGENT_SIGNUP", "on");
const pg = await migratedPglite();
const schema = { ...(await import("@/db/schema")), ...(await import("@/db/auth-schema")) };
const testDb = drizzle(pg, { schema });
vi.mock("@/db", () => ({ db: () => testDb, schema }));
const signedIn: { user: { id: string; email: string } | null } = { user: null };
vi.mock("@/lib/auth", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/auth")>();
  const auth = real.buildAuth({ clientId: "test", secret: "test-secret-".padEnd(40, "x"), baseURL: BASE });
  // The session read is the one stand-in: everything else on the instance is real.
  const withSession = Object.assign(Object.create(auth), { api: { ...auth.api, getSession: async () => (signedIn.user ? { user: signedIn.user, session: {} } : null) } });
  return { ...real, getAuth: async () => withSession, realAuth: auth };
});
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw Object.assign(new Error("redirect"), { to }); } }));

const { acceptClaimAction } = await import("./actions");
const { POST: register } = await import("@/app/v1/agent/identity/route");
const authModule = (await import("@/lib/auth")) as unknown as { realAuth: { handler: (r: Request) => Promise<Response> } };

/** Runs the action and returns where it sent the person. */
async function accept(token: string): Promise<string> {
  try {
    await acceptClaimAction(token);
  } catch (e) {
    return (e as { to: string }).to;
  }
  throw new Error("the action must always redirect");
}

let regId = "";
let token = "";
beforeAll(async () => {
  await pg.query(`insert into "user" (id, name, email) values ('u1', 'Ada', 'ada@x.test')`);
  const r = await (await register(new Request(`${BASE}/v1/agent/identity`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: "anonymous" }) }))).json();
  regId = r.registration_id;
  token = String(r.account.claim_url).slice(`${BASE}/claim/`.length);
});
afterAll(async () => { await pg.close(); });

const owner = async () => (await pg.query<{ user_id: string | null }>(`select user_id from qp_agent_registration where id = $1`, [regId])).rows[0].user_id;

describe("Accept on the claim page", () => {
  it("signed out: attaches nothing and sends the person back to the page", async () => {
    signedIn.user = null;
    expect(await accept(token)).toBe(`/claim/${token}`);
    expect(await owner()).toBeNull();
  });

  it("refuses a malformed token without touching the database", async () => {
    signedIn.user = { id: "u1", email: "ada@x.test" };
    expect(await accept("not-a-token")).toBe("/claim/unknown");
    expect(await owner()).toBeNull();
  });

  it("signed in: attaches the agent to the person in the session", async () => {
    signedIn.user = { id: "u1", email: "ada@x.test" };
    expect(await accept(token)).toBe(`/claim/${token}`);
    expect(await owner()).toBe("u1");
  });
});

describe("signing in from the claim page", () => {
  it("Better Auth accepts the claim page as where to come back to after Buffer", async () => {
    const res = await authModule.realAuth.handler(new Request(`${BASE}/api/auth/sign-in/social`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: BASE },
      body: JSON.stringify({ provider: "buffer", callbackURL: `/claim/${token}`, errorCallbackURL: `/claim/${token}` }),
    }));
    expect(res.status).toBe(200);
    const { url } = (await res.json()) as { url: string };
    expect(new URL(url).searchParams.get("state")).toBeTruthy();
    // The sign-in state Better Auth keeps for the return trip names the claim page as where to come back to.
    const states = (await pg.query<{ value: string }>(`select value from verification`)).rows.map((r) => r.value);
    expect(states.some((v) => v.includes(`/claim/${token}`))).toBe(true);
  });
});
