import { z } from "zod";
import { hasDatabase, postgresSettingsStore } from "./db";
import { memoryStore, resolveSetting } from "./settings";

/**
 * Runtime configuration for Buffer sign-in. Buffer keys come from /admin (saved, encrypted) first and the
 * environment second; secrets that protect the deployment itself (session, settings key) stay in the environment.
 * Missing values are reported so pages can stay up instead of crashing.
 */
const schema = z.object({
  BUFFER_CLIENT_ID: z.string().min(1),
  BUFFER_CLIENT_SECRET: z.string().min(1).optional(),
  BUFFER_REDIRECT_URI: z.string().url(),
  SESSION_SECRET: z.string().min(32),
});

export type Env = z.infer<typeof schema>;

/** Returns the working configuration, or the names of what is missing (for server logs only, never for visitors). */
export async function readConfig(): Promise<{ ok: true; env: Env } | { ok: false; missing: string[] }> {
  const merged: Record<string, string | undefined> = { ...process.env };
  const master = process.env.SETTINGS_KEY;
  if (master) {
    const store = hasDatabase() ? postgresSettingsStore() : memoryStore();
    try {
      const [id, secret] = await Promise.all([resolveSetting(store, "buffer_client_id", master), resolveSetting(store, "buffer_client_secret", master)]);
      if (id) merged.BUFFER_CLIENT_ID = id.value;
      if (secret) merged.BUFFER_CLIENT_SECRET = secret.value;
    } catch (e) {
      console.error(JSON.stringify({ event: "qp-settings-read-failed", message: e instanceof Error ? e.message : String(e) }));
    }
  }
  const r = schema.safeParse(merged);
  if (r.success) return { ok: true, env: r.data };
  return { ok: false, missing: r.error.issues.map((i) => String(i.path[0])) };
}

/** The Supadata key for YouTube transcripts, saved in /admin or in the environment; null when neither is set. */
export async function supadataKey(): Promise<string | null> {
  const master = process.env.SETTINGS_KEY;
  if (!master || !hasDatabase()) return process.env.SUPADATA_API_KEY || null;
  try {
    return (await resolveSetting(postgresSettingsStore(), "supadata_api_key", master))?.value ?? null;
  } catch (e) {
    console.error(JSON.stringify({ event: "qp-settings-read-failed", message: e instanceof Error ? e.message : String(e) }));
    return process.env.SUPADATA_API_KEY || null;
  }
}
