import { z } from "zod";
import { hasDatabase, postgresSettingsStore } from "./db";
import { memoryStore, resolveSetting, type SettingKey, type SettingsStore } from "./settings";

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
  const buffer = await operatorSettings(["buffer_client_id", "buffer_client_secret"]);
  const merged: Record<string, string | undefined> = { ...process.env, BUFFER_CLIENT_ID: buffer.buffer_client_id ?? undefined, BUFFER_CLIENT_SECRET: buffer.buffer_client_secret ?? undefined };
  const r = schema.safeParse(merged);
  if (r.success) return { ok: true, env: r.data };
  return { ok: false, missing: r.error.issues.map((i) => String(i.path[0])) };
}

/** Where operator settings are read from: the saved values, the key that decrypts them, and the server's environment. */
export type SettingsSource = { store: SettingsStore; master: string; env: Record<string, string | undefined> };

/** This deployment's saved settings when it has a database and a settings key; without them only the environment applies. */
function deploymentSource(): SettingsSource {
  const master = process.env.SETTINGS_KEY;
  if (!master || !hasDatabase()) return { store: memoryStore(), master: "", env: process.env };
  return { store: postgresSettingsStore(), master, env: process.env };
}

/**
 * Operator settings by the registry's rule (src/lib/settings.ts): saved in /admin, else the server's environment, else
 * the default; null when none is set. When the saved values cannot be read, the environment and defaults still apply.
 */
export async function operatorSettings<K extends SettingKey>(keys: readonly K[], src: SettingsSource = deploymentSource()): Promise<Record<K, string | null>> {
  const read = async (key: K) => {
    try {
      return (await resolveSetting(src.store, key, src.master, src.env))?.value ?? null;
    } catch (e) {
      console.error(JSON.stringify({ event: "qp-settings-read-failed", setting: key, message: e instanceof Error ? e.message : String(e) }));
      return (await resolveSetting(memoryStore(), key, "", src.env))?.value ?? null;
    }
  };
  const values = await Promise.all(keys.map(read));
  return Object.fromEntries(keys.map((k, i) => [k, values[i]])) as Record<K, string | null>;
}

/** One operator setting by the same rule as {@link operatorSettings}; null when none is set. */
export async function operatorSetting(key: SettingKey, src?: SettingsSource): Promise<string | null> {
  return (await operatorSettings([key], src))[key];
}

/** The Supadata key for YouTube transcripts, saved in /admin or in the environment; null when neither is set. */
export const supadataKey = () => operatorSetting("supadata_api_key");

/** The Exa key for web search and page reading, saved in /admin or in the environment; null when neither is set. */
export const exaKey = () => operatorSetting("exa_api_key");
