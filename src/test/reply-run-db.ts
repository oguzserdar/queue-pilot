/**
 * @fileoverview The PGlite database, with the real migrations, behind the reply-run tests. Kept apart from
 * reply-run-setup.ts so a test file's "@/db" mock can load it without loading the modules that use "@/db".
 */
import { vi } from "vitest";
import { drizzle } from "drizzle-orm/pglite";
import { migratedPglite } from "./migrated-pglite";

/** The key the test accounts' credentials are encrypted with. */
export const settingsKey = "34".repeat(32);
vi.stubEnv("SETTINGS_KEY", settingsKey);
/** One migrated database per test file. */
export const pg = await migratedPglite();
/** The Drizzle client the "@/db" mock hands out. */
export const testDb = drizzle(pg, { schema: { ...(await import("@/db/schema")), ...(await import("@/db/auth-schema")) } });
