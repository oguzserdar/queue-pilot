/**
 * @fileoverview The /admin server actions on real Postgres (PGlite) with the real migrations: claiming a deployment
 * needs a valid setup code in production, and every settings change records the admin from the server session.
 */
import { migratedPglite } from "@/test/migrated-pglite";
import { drizzle } from "drizzle-orm/pglite";
import { AsyncLocalStorage } from "node:async_hooks";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const pg = await migratedPglite();
const testDb = drizzle(pg, { schema: { ...(await import("../../db/schema")), ...(await import("../../db/auth-schema")) } });
vi.mock("@/db", () => ({ db: () => testDb, schema: {} }));

/** next/navigation's redirect ends the action by throwing; the test reads where it went. */
class Redirected extends Error { constructor(readonly to: string) { super(to); } }
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Redirected(to); } }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

let signedIn: string | null = null;
/** Who is signed in for one request, so two claims can run at once as different people. */
const request = new AsyncLocalStorage<string>();
const current = () => request.getStore() ?? signedIn;
const roleOf = async (id: string | null) => (id ? (await pg.query<{ role: string | null }>(`select role from "user" where id = $1`, [id])).rows[0]?.role ?? null : null);
vi.mock("@/lib/current-user", () => ({
  signedInUserId: async () => current(),
  adminAccess: async () => (!current() ? "signed-out" : (await roleOf(current())) === "admin" ? "admin" : "not-admin"),
}));
vi.mock("@/lib/rate-limit", () => ({ limit: async () => ({ ok: true }) }));
vi.mock("@/lib/db", async (load) => ({ ...(await load<typeof import("@/lib/db")>()), hasDatabase: () => true }));

const { claimAdmin, clearAdminSetting, keepAdminSetting, saveAdminSetting } = await import("./actions");
const { recentSettingChanges } = await import("@/lib/db");

const CODE = "a-long-enough-setup-code-for-tests";
const form = (fields: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(fields)) f.set(k, v); return f; };
/** Runs an action as someone and returns where it redirected. */
async function as(userId: string | null, action: (f: FormData) => Promise<unknown>, fields: Record<string, string> = {}): Promise<string> {
  signedIn = userId;
  try { await action(form(fields)); } catch (e) { if (e instanceof Redirected) return e.to; throw e; }
  throw new Error("the action did not redirect");
}
/** Runs a settings action as someone and returns what it answered; a refused caller is still sent to /admin. */
async function result(userId: string | null, action: (prev: null, f: FormData) => Promise<{ ok: boolean; message: string }>, fields: Record<string, string> = {}) {
  signedIn = userId;
  try { return await action(null, form(fields)); } catch (e) { if (e instanceof Redirected) return { redirected: e.to }; throw e; }
}

beforeAll(async () => {
  await pg.query(`insert into "user" (id, name, email, role) values ('u1', 'a', 'a@x', 'user'), ('u2', 'b', 'b@x', 'user'), ('u3', 'c', 'c@x', 'user')`);
});
beforeEach(async () => { await pg.query(`update "user" set role = 'user'`); });
afterEach(() => { vi.unstubAllEnvs(); });
afterAll(async () => { await pg.close(); });

describe("claiming a deployment in production", () => {
  beforeEach(() => { vi.stubEnv("NODE_ENV", "production"); });

  it("refuses the claim when no setup code is configured, even with no admin left", async () => {
    vi.stubEnv("ADMIN_SETUP_CODE", "");
    expect(await as("u1", claimAdmin, { code: "" })).toBe("/admin?problem=setup");
    expect(await roleOf("u1")).toBe("user");
  });

  it("refuses the claim when the configured code is too short to be safe", async () => {
    vi.stubEnv("ADMIN_SETUP_CODE", "short-code");
    expect(await as("u1", claimAdmin, { code: "short-code" })).toBe("/admin?problem=setup");
    expect(await roleOf("u1")).toBe("user");
  });

  it("refuses a wrong code", async () => {
    vi.stubEnv("ADMIN_SETUP_CODE", CODE);
    expect(await as("u1", claimAdmin, { code: `${CODE}-not` })).toBe("/admin?problem=code");
    expect(await roleOf("u1")).toBe("user");
  });

  it("makes the person with the right code the admin", async () => {
    vi.stubEnv("ADMIN_SETUP_CODE", CODE);
    expect(await as("u1", claimAdmin, { code: ` ${CODE} ` })).toBe("/admin");
    expect(await roleOf("u1")).toBe("admin");
  });

  it("keeps an existing admin, and gives nobody else the role, right code or not", async () => {
    vi.stubEnv("ADMIN_SETUP_CODE", CODE);
    await pg.query(`update "user" set role = 'admin' where id = 'u1'`);
    expect(await as("u2", claimAdmin, { code: CODE })).toBe("/admin");
    expect(await roleOf("u2")).toBe("user");
    expect(await roleOf("u1")).toBe("admin");
    vi.stubEnv("ADMIN_SETUP_CODE", "");
    expect(await roleOf("u1")).toBe("admin");
  });

  it("lets only one of two people claiming at the same moment become the admin", async () => {
    vi.stubEnv("ADMIN_SETUP_CODE", CODE);
    const claim = (id: string) => request.run(id, () => claimAdmin(form({ code: CODE })).catch((e) => { if (!(e instanceof Redirected)) throw e; }));
    await Promise.all([claim("u2"), claim("u3")]);
    const roles = [await roleOf("u2"), await roleOf("u3")];
    expect(roles.filter((r) => r === "admin")).toHaveLength(1);
  });
});

describe("claiming outside production", () => {
  it("still lets the first person claim without a code when none is configured", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("ADMIN_SETUP_CODE", "");
    expect(await as("u1", claimAdmin, {})).toBe("/admin");
    expect(await roleOf("u1")).toBe("admin");
  });
});

describe("recording who changed a setting", () => {
  beforeEach(async () => {
    vi.stubEnv("SETTINGS_KEY", "c".repeat(64));
    await pg.query(`update "user" set role = 'admin' where id = 'u1'`);
  });

  it("records the signed-in admin for a save, a keep and a remove, never a form's claim or a secret's value", async () => {
    expect(await result("u1", saveAdminSetting, { key: "exa_api_key", value: "exa-very-secret-value", actor: "u2", by: "u2" })).toEqual({ ok: true, message: "Exa API key saved. It is in use now." });
    await pg.query(`update operator_settings set admin_wins = false where key = 'exa_api_key'`);
    await pg.query(`insert into qp_settings_audit (key, action) values ('exa_api_key', 'set')`);
    expect(await result("u1", keepAdminSetting, { key: "exa_api_key", actor: "u2" })).toEqual({ ok: true, message: "Exa API key: the saved value is in use now." });
    expect(await result("u1", clearAdminSetting, { key: "exa_api_key", actor: "u2" })).toMatchObject({ ok: true, message: expect.stringMatching(/^Exa API key removed\. /) });
    const rows = (await pg.query<Record<string, unknown>>(`select key, action, actor_id, from_value, to_value from qp_settings_audit where key = 'exa_api_key' order by id`)).rows;
    expect(rows.map((r) => [r.action, r.actor_id])).toEqual([["set", "u1"], ["set", null], ["kept", "u1"], ["cleared", "u1"]]);
    expect(JSON.stringify(rows)).not.toContain("exa-very-secret");
    const shown = await recentSettingChanges(4);
    expect(shown.map((c) => c.actorEmail)).toEqual(["a@x", "a@x", null, "a@x"]);
    expect(shown.map((c) => c.actorId)).toEqual(["u1", "u1", null, "u1"]);
  });

  it("refuses a change from someone who is not the admin and records nothing", async () => {
    const before = (await pg.query<{ n: number }>(`select count(*)::int as n from qp_settings_audit`)).rows[0].n;
    expect(await result("u2", saveAdminSetting, { key: "ai_cap_per_person", value: "50" })).toEqual({ redirected: "/admin" });
    expect((await pg.query<{ n: number }>(`select count(*)::int as n from qp_settings_audit`)).rows[0].n).toBe(before);
  });
});

describe("setting names", () => {
  it.each(["constructor", "toString", "__proto__"])("refuses %s, a name every object has but no setting is called", async (key) => {
    await pg.query(`update "user" set role = 'admin' where id = 'u1'`);
    for (const action of [saveAdminSetting, clearAdminSetting, keepAdminSetting])
      expect(await result("u1", action, { key, value: "x" })).toEqual({ ok: false, message: "Unknown setting." });
  });
});

describe("saying what a change did", () => {
  beforeEach(async () => {
    vi.stubEnv("SETTINGS_KEY", "c".repeat(64));
    await pg.query(`update "user" set role = 'admin' where id = 'u1'`);
  });

  it("names what applies after a remove: the server's value when it sets one, else the default", async () => {
    await result("u1", saveAdminSetting, { key: "ai_cap_per_person", value: "20" });
    expect(await result("u1", clearAdminSetting, { key: "ai_cap_per_person" })).toMatchObject({ ok: true, message: expect.stringContaining("The default applies again.") });
    vi.stubEnv("AI_CAP_PER_PERSON", "30");
    await result("u1", saveAdminSetting, { key: "ai_cap_per_person", value: "20" });
    expect(await result("u1", clearAdminSetting, { key: "ai_cap_per_person" })).toMatchObject({ ok: true, message: expect.stringContaining("The server environment's value applies again.") });
  });

  it("answers a value it cannot save with the reason, for the alert beside the field", async () => {
    const r = await result("u1", saveAdminSetting, { key: "ai_cap_per_person", value: "lots" });
    expect(r).toMatchObject({ ok: false });
    expect((r as { message: string }).message.length).toBeGreaterThan(5);
  });
});
