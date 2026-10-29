/**
 * @fileoverview The /admin gate: reading Better Auth's role column, and claiming admin on a deployment that has none.
 */
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Real Postgres (PGLite) with the real migrations, behind the app's Drizzle client.
const pg = new PGlite();
const testDb = drizzle(pg, { schema: { ...(await import("../db/schema")), ...(await import("../db/auth-schema")) } });
vi.mock("../db", () => ({ db: () => testDb, schema: {} }));

const { claimAdminIfNone, hasAdmin, isAdminRole } = await import("./admin-role");
const role = async (id: string) => (await pg.query<{ role: string | null }>(`select role from "user" where id = $1`, [id])).rows[0]?.role;

beforeAll(async () => {
  await migrate(testDb, { migrationsFolder: join(__dirname, "../../drizzle"), migrationsTable: "__drizzle_migrations__", migrationsSchema: "public" });
  await pg.query(`insert into "user" (id, name, email, role) values ('first', 'a', 'a@x', 'user'), ('second', 'b', 'b@x', 'user')`);
});
afterAll(async () => { await pg.close(); });

describe("claiming admin on a fresh deployment", () => {
  it("has no admin before anyone claims it", async () => {
    expect(await hasAdmin()).toBe(false);
  });

  it("lets the person who presses the button become the admin", async () => {
    expect(await claimAdminIfNone("first")).toBe(true);
    expect(await role("first")).toBe("admin");
    expect(await hasAdmin()).toBe(true);
  });

  it("refuses everyone after that", async () => {
    expect(await claimAdminIfNone("second")).toBe(false);
    expect(await role("second")).toBe("user");
  });
});

describe("isAdminRole", () => {
  it("reads Better Auth's comma-separated roles", () => {
    expect(isAdminRole("admin")).toBe(true);
    expect(isAdminRole("user,admin")).toBe(true);
    expect(isAdminRole("user")).toBe(false);
    expect(isAdminRole("administrator")).toBe(false);
    expect(isAdminRole(null)).toBe(false);
  });
});
