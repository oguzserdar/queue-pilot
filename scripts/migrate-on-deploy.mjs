/**
 * Applies Drizzle migrations before the app serves: on Vercel during a production deploy (before `next build`), and in
 * Docker on container start (MIGRATE_ON_START=1, set in the Dockerfile). Vercel preview and local builds share the
 * production database settings, so they skip.
 * Uses drizzle-orm's migrator (the same call the app's admin action makes), which reports the database's own error.
 */
import { join } from "node:path";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { envProblems } from "../src/lib/env-check.mjs";

if (process.env.VERCEL_ENV !== "production" && process.env.MIGRATE_ON_START !== "1") {
  console.log(`[migrate] skipped: VERCEL_ENV is ${process.env.VERCEL_ENV ?? "unset"} and MIGRATE_ON_START is not 1`);
  process.exit(0);
}
const problems = envProblems();
if (problems.length) {
  console.error(`[start] Queue Pilot cannot start until these are fixed:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
  process.exit(1);
}
const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
if (!url) {
  console.error("[migrate] no DATABASE_URL_UNPOOLED or DATABASE_URL; refusing to build without a database to migrate");
  process.exit(1);
}
const pool = new pg.Pool({ connectionString: url, max: 1 });
try {
  await migrate(drizzle(pool), { migrationsFolder: join(process.cwd(), "drizzle"), migrationsTable: "__drizzle_migrations__", migrationsSchema: "public" });
  console.log("[migrate] done");
} catch (e) {
  console.error("[migrate] failed:", e instanceof Error ? `${e.message}${e.cause ? ` (cause: ${e.cause.message ?? e.cause})` : ""}` : e);
  process.exitCode = 1;
} finally {
  await pool.end();
}
