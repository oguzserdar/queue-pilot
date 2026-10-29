/**
 * Only for `auth generate` (Better Auth's CLI): an instance with the same plugins as production, so the generated
 * Drizzle schema has every table they need. The values are placeholders; nothing here connects or signs anything.
 */
import { buildAuth } from "../lib/auth";

export const auth = buildAuth({ clientId: "schema-only", secret: "schema-only-".padEnd(40, "x"), baseURL: "http://localhost:3000" });
