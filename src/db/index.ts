/**
 * The Drizzle client on the app's one shared pg Pool. App tables and Better Auth's tables share one schema object,
 * so relations and the Better Auth
 * Drizzle adapter see every table.
 */
import { drizzle } from "drizzle-orm/node-postgres";
import { dbPool } from "../lib/db";
import * as appSchema from "./schema";
import * as authSchema from "./auth-schema";

export const schema = { ...appSchema, ...authSchema };

let client: ReturnType<typeof drizzle<typeof schema>> | null = null;

/** The Drizzle client, created on first use so pages that never touch the database never open the pool. */
export function db() {
  client ??= drizzle(dbPool(), { schema });
  return client;
}
