/**
 * @fileoverview The database half of the agent-signup test setup: PGlite with every migration behind the app's Drizzle
 * client. It imports nothing the test files mock, so their mock factories can load it while the routes load.
 */
import { vi } from "vitest";
import { drizzle } from "drizzle-orm/pglite";
import { migratedPglite } from "./migrated-pglite";

export const BASE = "https://qp.example";
vi.stubEnv("DATABASE_URL", "postgres://test@localhost/unused");
// Addresses come from X-Forwarded-For, one hop, so each test can be its own caller.
vi.stubEnv("TRUSTED_PROXY_HOP_COUNT", "1");
export const pg = await migratedPglite();
export const schema = { ...(await import("@/db/schema")), ...(await import("@/db/auth-schema")) };
export const testDb = drizzle(pg, { schema });
