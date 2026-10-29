import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as appSchema from "./schema";
import * as authSchema from "./auth-schema";
import { getTableConfig } from "drizzle-orm/pg-core";
import { is } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";

// The real migration files, applied by Drizzle's migrator to real Postgres (PGLite), exactly as "Set up tables" does.
describe("drizzle migrations", () => {
  it("create every table in the schema, and running them twice changes nothing", async () => {
    const pg = new PGlite();
    const db = drizzle(pg);
    const opts = { migrationsFolder: join(__dirname, "../../drizzle"), migrationsTable: "__drizzle_migrations__", migrationsSchema: "public" };
    await migrate(db, opts);
    await migrate(db, opts);
    const rows = (await pg.query<{ table_name: string }>("select table_name from information_schema.tables where table_schema = 'public'")).rows.map((r) => r.table_name);
    const expected = Object.values({ ...appSchema, ...authSchema }).filter((t) => is(t, PgTable)).map((t) => getTableConfig(t as PgTable).name);
    expect(expected.length).toBeGreaterThan(15);
    for (const name of expected) expect(rows).toContain(name);
    await pg.close();
    // Starting PGLite and applying every migration twice takes about 6 s alone on a busy machine, past the 5 s default.
  }, 30_000);
});
