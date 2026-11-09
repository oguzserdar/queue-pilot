/**
 * @fileoverview Builds one migrated Postgres (PGlite) for the whole test run. Every database suite used to start its
 * own and run all migrations from scratch; with many suites starting at once on a busy machine, that setup alone
 * passed the time limit. Now the migrations run once here, the result is saved as a data-directory file, and each
 * suite opens a copy of it with `migratedPglite()`.
 */
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestProject } from "vitest/node";

declare module "vitest" {
  export interface ProvidedContext {
    /** Path of the migrated data directory that `migratedPglite()` opens. */
    pgliteSnapshot: string;
  }
}

export default async function setup(project: TestProject) {
  const pg = await PGlite.create();
  await migrate(drizzle(pg), { migrationsFolder: join(__dirname, "../../drizzle"), migrationsTable: "__drizzle_migrations__", migrationsSchema: "public" });
  const file = join(tmpdir(), `qp-pglite-${process.pid}-${Date.now()}.tar`);
  await writeFile(file, Buffer.from(await (await pg.dumpDataDir("none")).arrayBuffer()));
  await pg.close();
  project.provide("pgliteSnapshot", file);
  return async () => { await rm(file, { force: true }); };
}
