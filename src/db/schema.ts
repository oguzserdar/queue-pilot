/**
 * Queue Pilot's own tables (Drizzle). Better Auth's tables are generated into auth-schema.ts by its CLI
 * (`auth generate --adapter drizzle`); both files feed drizzle-kit, which writes the migrations in ../../drizzle.
 * Every table is keyed or scoped by the signed-in user's id. The tables live in three files by area; this file
 * re-exports them all, so every import of ./schema and drizzle.config.ts stay as they were.
 */
export * from "./schema-posting";
export * from "./schema-review";
export * from "./schema-replies";
