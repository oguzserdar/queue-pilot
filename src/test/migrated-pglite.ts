/**
 * @fileoverview Opens a private copy of the migrated test database built once per run by `pglite-snapshot.global.ts`.
 */
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { inject } from "vitest";

/**
 * Returns a ready PGlite with every migration applied, as a fresh copy for the calling suite: writes in one suite
 * never reach another.
 */
export async function migratedPglite(): Promise<PGlite> {
  return PGlite.create({ loadDataDir: new Blob([await readFile(inject("pgliteSnapshot"))]) });
}
