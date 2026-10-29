import { defineConfig } from "drizzle-kit";

/**
 * Migrations are generated from the schema files (pnpm db:generate) and applied on every production deploy
 * (scripts/migrate-on-deploy.mjs), over the direct connection: Neon's pooled URL is not meant for migrations.
 */
export default defineConfig({
  dialect: "postgresql",
  out: "./drizzle",
  schema: ["./src/db/schema.ts", "./src/db/auth-schema.ts"],
  dbCredentials: { url: process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL ?? "" },
  migrations: { prefix: "timestamp", table: "__drizzle_migrations__", schema: "public" },
  breakpoints: true,
  strict: true,
  verbose: true,
});
