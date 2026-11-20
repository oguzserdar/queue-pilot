/**
 * @fileoverview Shared setup for the postgres-stores-*.test.ts files: real Postgres (PGLite) with the real migrations
 * applied, behind the app's Drizzle client, so the production stores run their exact Drizzle queries against it.
 * Each test file mocks "../db" with `testDb` (a mock is only hoisted in the test file itself) and seeds the people.
 */
import { drizzle } from "drizzle-orm/pglite";
import { migratedPglite } from "./migrated-pglite";

/** This test file's own copy of the migrated database. */
export const pg = await migratedPglite();
/** The app's Drizzle client over `pg`, with the app and auth schemas. */
export const testDb = drizzle(pg, { schema: { ...(await import("../db/schema")), ...(await import("../db/auth-schema")) } });

/** Every app table references the user row, so the people these tests act for must exist. */
export async function seedPeople(): Promise<void> {
  const ids = ["u1", "u2", "u3", "u4", "u5", "u6", "u7", "u8"];
  await pg.query(`insert into "user" (id, name, email) values ${ids.map((id) => `('${id}', '${id}', '${id}@x')`).join(", ")}`);
}
