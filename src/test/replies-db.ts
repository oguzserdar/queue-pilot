/**
 * @fileoverview The PGlite database, with the real migrations, behind the reply engine tests. Kept apart from
 * replies-setup.ts so a test file's "@/db" mock can load it without loading the modules that use "@/db".
 */
import { drizzle } from "drizzle-orm/pglite";
import { migratedPglite } from "./migrated-pglite";

/** One migrated database per test file. */
export const pg = await migratedPglite();
/** The Drizzle client the "@/db" mock hands out. */
export const testDb = drizzle(pg, { schema: { ...(await import("@/db/schema")), ...(await import("@/db/auth-schema")) } });
