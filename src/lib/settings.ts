/**
 * Operator settings, entered in /admin. One registry declares every setting with its section, type, default, help text
 * and environment variable. Values are parsed by type before they are stored, secrets are stored
 * encrypted (src/lib/secrets.ts) and only ever shown masked.
 *
 * Which value applies: the value saved in /admin, else the server's environment variable, else the default. So an
 * operator can change any of these from /admin without touching the server, and removing the saved value goes back to
 * the environment's. Bootstrap values (SETTINGS_KEY, SESSION_SECRET, DATABASE_URL, ADMIN_SETUP_CODE, CRON_SECRET,
 * BUFFER_REDIRECT_URI, TRUSTED_PROXIES) are environment-only and not listed here: a key never lives in the database it
 * unlocks, and the server needs them before /admin can open.
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
  copies: { title: "Copies to Telegram and Discord", help: "Optional. The shared bots that copy people's sent posts to their own Telegram channel or Discord server." },
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
  exa_api_key: { group: "sources", label: "Exa API key", help: "Optional. Lets the AI search the web for deeper context and save a page as material.", type: "secret", env: "EXA_API_KEY", default: null },
  telegram_bot_token: { group: "copies", label: "Telegram bot token", help: "From @BotFather. Telegram copies turn on when this and the bot's username are both set.", type: "secret", env: "TELEGRAM_BOT_TOKEN", default: null },
  telegram_bot_username: { group: "copies", label: "Telegram bot username", help: "The bot's username, without the @. People add this bot as an admin of their channel.", type: "string", env: "TELEGRAM_BOT_USERNAME", default: null },
  discord_client_id: { group: "copies", label: "Discord application ID", help: "From the Discord Developer Portal, General Information. It is public and goes in the Add to server link.", type: "string", env: "DISCORD_CLIENT_ID", default: null },
  discord_client_secret: { group: "copies", label: "Discord client secret", help: "From the Discord Developer Portal, OAuth2. Used when someone adds the bot to their server.", type: "secret", env: "DISCORD_CLIENT_SECRET", default: null },
  discord_bot_token: { group: "copies", label: "Discord bot token", help: "From the Discord Developer Portal, Bot. Discord copies turn on when the application ID, client secret and this are all set.", type: "secret", env: "DISCORD_BOT_TOKEN", default: null },
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
export type Resolved = { value: string; source: Source } | null;

/** Where a setting's value comes from. */
export type Source = "saved" | "environment" | "default";
/** The order sources are tried in: saved in /admin, then the server's environment, then the default. */
const ORDER = ["saved", "environment", "default"] as const satisfies readonly Source[];

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

/** The working value of a setting: the one saved in /admin, else the environment's, else the default. */
export async function resolveSetting(store: SettingsStore, key: SettingKey, masterKeyHex: string, env: Record<string, string | undefined> = process.env): Promise<Resolved> {
  const saved = await store.get(key);
  if (saved !== null) return { value: isSecret(key) ? decryptSecret(saved, masterKeyHex) : saved, source: "saved" };
  const fromEnv = envValue(key, env);
  if (fromEnv) return { value: fromEnv, source: "environment" };
  const fallback = SETTINGS[key].default as string | null;
  return fallback !== null ? { value: fallback, source: "default" } : null;
}

/**
 * Settings whose value saved in /admin hides a value set in the server's environment. Before v0.8 the environment
 * won, so an old saved row can quietly replace a newer key or a lower cost ceiling set on the server.
 *
 * @param store - Where saved values live
 * @param env - The server's environment
 * @returns The setting keys, in registry order
 */
export async function shadowedSettings(store: SettingsStore, env: Record<string, string | undefined> = process.env): Promise<SettingKey[]> {
  const keys = Object.keys(SETTINGS) as SettingKey[];
  const hidden = await Promise.all(keys.map(async (key) => envValue(key, env) !== null && (await store.get(key)) !== null));
  return keys.filter((_, i) => hidden[i]);
}

/**
 * Logs, once, which settings have a saved value hiding the server's environment value. Names only, never values.
 *
 * @param store - Where saved values live
 * @param env - The server's environment
 */
export async function logShadowedSettings(store: SettingsStore, env: Record<string, string | undefined> = process.env): Promise<void> {
  const keys = await shadowedSettings(store, env);
  if (keys.length) console.warn(JSON.stringify({ event: "qp-setting-shadows-env", settings: keys, env: keys.map((k) => SETTINGS[k].env) }));
}

/**
 * Shape checks for values typed in /admin, beyond their type. Only a save is checked: a server environment value keeps
 * being read as before, so an existing deployment's "@name" still works (copies strip the @).
 */
const SAVE_CHECKS: Partial<Record<SettingKey, (v: string) => string | null>> = {
  telegram_bot_username: (v) =>
    v.startsWith("@") ? "Telegram bot username must be typed without the @"
      : /^[A-Za-z0-9_]{5,32}$/.test(v) && /bot$/i.test(v) ? null
      : "Telegram bot username must be 5 to 32 letters, digits or underscores, ending in \"bot\"",
  discord_client_id: (v) => (/^\d{17,20}$/.test(v) ? null : "Discord application ID must be 17 to 20 digits"),
};

/** Saves a setting from /admin after parsing it by its type; throws with the reason when it cannot be saved. */
export async function saveSetting(store: SettingsStore, key: SettingKey, input: string, masterKeyHex: string): Promise<void> {
  const parsed = parseSetting(key, input);
  if (!parsed.ok) throw new Error(parsed.error);
  const problem = SAVE_CHECKS[key]?.(parsed.value);
  if (problem) throw new Error(problem);
  await store.set(key, isSecret(key) ? encryptSecret(parsed.value, masterKeyHex) : parsed.value);
}

/** Removes a saved setting; the server's environment value, else the default, then applies again. */
export function clearSetting(store: SettingsStore, key: SettingKey): Promise<void> {
  return store.remove(key);
}

/**
 * What /admin shows for each setting: every source in the order it is tried (saved here, server env, default), the one
 * in use marked, secrets masked. Each saved value is read and decrypted once.
 */
export async function describeSettings(store: SettingsStore, masterKeyHex: string, env: Record<string, string | undefined> = process.env) {
  return Promise.all(
    (Object.keys(SETTINGS) as SettingKey[]).map(async (key) => {
      const def = SETTINGS[key];
      const saved = await store.get(key);
      const values: Record<Source, string | null> = {
        saved: saved === null ? null : isSecret(key) ? decryptSecret(saved, masterKeyHex) : saved,
        environment: envValue(key, env),
        default: def.default as string | null,
      };
      const source = ORDER.find((k) => values[k] !== null) ?? null;
      const shown = (v: string | null) => (v === null ? null : isSecret(key) ? maskSecret(v) : v);
      return {
        key,
        group: def.group as GroupId,
        label: def.label as string,
        help: def.help as string,
        type: def.type as Type,
        env: def.env as string,
        source,
        display: source ? shown(values[source]) : null,
        /** True when the value saved here hides one set in the server's environment. */
        shadowsEnv: values.saved !== null && values.environment !== null,
        /** Every source in the order they are tried, with the one in use marked; a value set lower down is shown as ignored. */
        layers: ORDER.map((k) => ({ source: k, display: shown(values[k]), inUse: k === source })),
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
