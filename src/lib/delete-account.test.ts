/**
 * @fileoverview Deleting an account removes the person's rows, except that the deployment's only admin cannot delete
 * their account: that would leave the deployment with nobody to manage its keys. Another admin, or an ordinary user,
 * deletes as before.
 */
import { migratedPglite } from "@/test/migrated-pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// Real Postgres (PGLite) with the real migrations, behind the app's Drizzle client.
const pg = await migratedPglite();
const testDb = drizzle(pg, { schema: { ...(await import("../db/schema")), ...(await import("../db/auth-schema")) } });
vi.mock("../db", () => ({ db: () => testDb, schema: {} }));

const { deleteAccount, LastAdminError } = await import("./delete-account");
const exists = async (id: string) => (await pg.query(`select 1 from "user" where id = $1`, [id])).rows.length === 1;

beforeEach(async () => {
  await pg.query(`delete from "user"`);
  await pg.query(`insert into "user" (id, name, email, role) values ('owner', 'o', 'o@x', 'admin'), ('member', 'm', 'm@x', 'user')`);
});
afterAll(async () => { await pg.close(); });

describe("deleteAccount", () => {
  it("refuses to delete the deployment's only admin and leaves the account intact", async () => {
    await expect(deleteAccount("owner")).rejects.toBeInstanceOf(LastAdminError);
    expect(await exists("owner")).toBe(true);
  });

  it("deletes an admin when another admin remains", async () => {
    await pg.query(`update "user" set role = 'user,admin' where id = 'member'`);
    await deleteAccount("owner");
    expect(await exists("owner")).toBe(false);
  });

  it("deletes an ordinary user", async () => {
    await deleteAccount("member");
    expect(await exists("member")).toBe(false);
    expect(await exists("owner")).toBe(true);
  });
});
