/**
 * Operator settings, entered in /admin. One registry declares every setting with its section, type, default, help text
 * and environment variable. Values are parsed by type before they are stored, secrets are stored
 * encrypted (src/lib/secrets.ts) and only ever shown masked.
 *
 * Which value applies: the server's environment variable when set (it pins the setting, and /admin shows it read-only),
 * else the value saved in /admin, else the default. Bootstrap secrets (SETTINGS_KEY, SESSION_SECRET)
 * are environment-only and not listed here: a key never lives in the database it unlocks.
 * The storage itself is injected so the same rules run against Postgres in production and memory in tests.
 */
import * as z from "zod";
import { providerOf } from "./ai-key-store";
import { decryptSecret, encryptSecret, maskSecret } from "./secrets";

/** The sections of /admin, each with its title and help. */
export const GROUPS = {
  buffer: { title: "Buffer app", help: "The app client people sign in with. From Settings, API in your Buffer account." },
  ai: { title: "Built-in AI", help: "This deployment's own AI key, used for people who have not connected their own AI. Its calls are billed to this key." },
  sources: { title: "Sources", help: "Optional services that bring in material to write from." },
} as const;
/** One /admin section. */
export type GroupId = keyof typeof GROUPS;

type Type = "string" | "secret" | "usd" | "int" | "ai-key";
type Def = { group: GroupId; label: string; help: string; type: Type; env: string; default: string | null };

/** Every operator setting: its section, label, help, type, environment name and default. */
export const SETTINGS = {
  buffer_client_id: { group: "buffer", label: "Client ID", help: "The app client's ID. It is public and goes in the submission.", type: "string", env: "BUFFER_CLIENT_ID", default: null },
  buffer_client_secret: { group: "buffer", label: "Client secret", help: "The app client's secret. Stored encrypted, never shown again.", type: "secret", env: "BUFFER_CLIENT_SECRET", default: null },
  fallback_ai_key: { group: "ai", label: "AI key", help: "An Anthropic, OpenAI or OpenRouter key. Built-in AI stays off until a budget is set too.", type: "ai-key", env: "FALLBACK_AI_KEY", default: null },
  ai_budget_usd: { group: "ai", label: "Budget (US dollars)", help: "Total to spend on built-in AI, all time. Each action's real cost is counted, and built-in AI stops when this is reached.", type: "usd", env: "AI_BUDGET_USD", default: null },
  ai_cap_per_person: { group: "ai", label: "Actions per person per day", help: "How many AI actions one person can run on your key each day.", type: "int", env: "AI_CAP_PER_PERSON", default: "10" },
  ai_cap_total: { group: "ai", label: "Actions per day, everyone", help: "Optional ceiling on all built-in AI actions in one day, to spread the budget over time. Empty means no daily ceiling.", type: "int", env: "AI_CAP_TOTAL", default: null },
  supadata_api_key: { group: "sources", label: "Supadata API key", help: "Optional. Adds YouTube transcripts to the material drafts are written from.", type: "secret", env: "SUPADATA_API_KEY", default: null },
} as const satisfies Record<string, Def>;

/** One operator setting. */
export type SettingKey = keyof typeof SETTINGS;

/** True for settings stored encrypted and shown masked. */
export const isSecret = (key: SettingKey) => SETTINGS[key].type === "secret" || SETTINGS[key].type === "ai-key";

/** One parser per type. Each returns the form that is stored. */
const PARSERS: Record<Type, z.ZodType<string, string>> = {
  string: z.string().trim().min(1, "cannot be empty").max(500),
  secret: z.string().trim().min(1, "cannot be empty").max(2000),
  "ai-key": z.string().trim().min(1, "cannot be empty").refine((k) => providerOf(k) !== null, "must be an Anthropic (sk-ant-…), OpenAI (sk-…) or OpenRouter (sk-or-v1-…) key"),
  usd: z.string().trim().min(1, "cannot be empty")
    .transform((s) => s.replace(/[$,\s]/g, ""))
    .refine((s) => /^\d+(\.\d{1,2})?$/.test(s), "must be a dollar amount, like 400 or 12.50")
    .transform((s) => Number(s).toFixed(2)),
  int: z.string().trim().min(1, "cannot be empty").refine((s) => /^\d+$/.test(s), "must be a whole number, 0 or more").transform((s) => String(Number(s))),
};

/** Parses what was typed for a setting into the form it is stored in, or says why it cannot be saved. */
export function parseSetting(key: SettingKey, input: string): { ok: true; value: string } | { ok: false; error: string } {
  const r = PARSERS[SETTINGS[key].type].safeParse(input);
  return r.success ? { ok: true, value: r.data } : { ok: false, error: `${SETTINGS[key].label} ${r.error.issues[0]?.message ?? "is not valid"}` };
}

/** One row per setting; secret values hold the encrypted form only. */
export type SettingsStore = {
  get(key: SettingKey): Promise<string | null>;
  set(key: SettingKey, stored: string): Promise<void>;
  remove(key: SettingKey): Promise<void>;
};

/** A setting's working value and where it came from, or null when it has none. */
export type Resolved = { value: string; source: "environment" | "saved" | "default" } | null;

/**
 * A setting's value from the server's environment, read by the same parser as a value saved in /admin, so "$400"
 * means 400.00. A value the parser refuses is logged and ignored, never used raw.
 */
function envValue(key: SettingKey, env: Record<string, string | undefined>): string | null {
  const raw = env[SETTINGS[key].env]?.trim();
  if (!raw) return null;
  const parsed = parseSetting(key, raw);
  if (parsed.ok) return parsed.value;
  console.error(JSON.stringify({ event: "qp-env-setting-invalid", setting: SETTINGS[key].env, message: parsed.error }));
  return null;
}

/** The working value of a setting: the environment's when set, else the saved one, else the default. */
export async function resolveSetting(store: SettingsStore, key: SettingKey, masterKeyHex: string, env: Record<string, string | undefined> = process.env): Promise<Resolved> {
  const fromEnv = envValue(key, env);
  if (fromEnv) return { value: fromEnv, source: "environment" };
  const saved = await store.get(key);
  if (saved !== null) return { value: isSecret(key) ? decryptSecret(saved, masterKeyHex) : saved, source: "saved" };
  const fallback = SETTINGS[key].default as string | null;
  return fallback !== null ? { value: fallback, source: "default" } : null;
}

/** Saves a setting from /admin after parsing it by its type; throws with the reason when it cannot be saved. */
export async function saveSetting(store: SettingsStore, key: SettingKey, input: string, masterKeyHex: string): Promise<void> {
  const parsed = parseSetting(key, input);
  if (!parsed.ok) throw new Error(parsed.error);
  await store.set(key, isSecret(key) ? encryptSecret(parsed.value, masterKeyHex) : parsed.value);
}

/** Removes a saved setting; the environment value or default then applies. */
export function clearSetting(store: SettingsStore, key: SettingKey): Promise<void> {
  return store.remove(key);
}

/**
 * What /admin shows for each setting: every source in the order it is tried (server env, saved here, default), the one
 * in use marked, secrets masked. Each saved value is read and decrypted once.
 */
export async function describeSettings(store: SettingsStore, masterKeyHex: string, env: Record<string, string | undefined> = process.env) {
  return Promise.all(
    (Object.keys(SETTINGS) as SettingKey[]).map(async (key) => {
      const def = SETTINGS[key];
      const saved = await store.get(key);
      const values = {
        environment: envValue(key, env),
        saved: saved === null ? null : isSecret(key) ? decryptSecret(saved, masterKeyHex) : saved,
        default: def.default as string | null,
      };
      const source = (["environment", "saved", "default"] as const).find((k) => values[k] !== null) ?? null;
      const shown = (v: string | null) => (v === null ? null : isSecret(key) ? maskSecret(v) : v);
      return {
        key,
        group: def.group as GroupId,
        label: def.label as string,
        help: def.help as string,
        type: def.type as Type,
        env: def.env as string,
        source,
        /** True when the environment sets it, so /admin cannot change it. */
        pinned: source === "environment",
        display: source ? shown(values[source]) : null,
        /** Every source in the order they are tried, with the one in use marked; a value set lower down is shown as ignored. */
        layers: (["environment", "saved", "default"] as const).map((k) => ({ source: k, display: shown(values[k]), inUse: k === source })),
      };
    }),
  );
}

/** In-memory store for tests and local runs without a database. */
export function memoryStore(): SettingsStore & { raw: Map<SettingKey, string> } {
  const raw = new Map<SettingKey, string>();
  return {
    raw,
    get: async (k) => raw.get(k) ?? null,
    set: async (k, v) => { raw.set(k, v); },
    remove: async (k) => { raw.delete(k); },
  };
}
