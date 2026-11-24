/**
 * Operator settings, entered in /admin. One registry declares every setting with its section, type, default, help text
 * and environment variable. Values are parsed by type before they are stored, secrets are stored
 * encrypted (src/lib/secrets.ts) and only ever shown masked.
 *
 * Which value applies: the value saved in /admin, else the server's environment variable, else the default. So an
 * operator can change any of these from /admin without touching the server, and removing the saved value goes back to
 * the environment's. One exception covers the upgrade: before v0.8 the environment won, so a value saved before then
 * (no "admin wins" mark) does not replace a set environment value. The environment's value stays in use until the
 * operator saves the value again, or chooses "Use the saved value", in /admin. Bootstrap values (SETTINGS_KEY, SESSION_SECRET, DATABASE_URL, ADMIN_SETUP_CODE, CRON_SECRET,
 * BUFFER_REDIRECT_URI, TRUSTED_PROXIES, TRUSTED_PROXY_HOP_COUNT) are environment-only and not listed here: a key never lives in the database it
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
  copies: { title: "Telegram and Discord", help: "Optional. The shared bots that post to people's own Telegram channel or Discord server: copies of published Buffer posts, and posts written in Queue Pilot." },
  meta: { title: "Meta app (Instagram)", help: "Optional. Your own Meta developer app, for answering Instagram comments and messages. Each server brings its own app; comment notifications need Meta's app review (Advanced Access) before they arrive." },
  agents: { title: "Agent sign-up", help: "AI agents that sign themselves up with no person present (see /auth.md). They can only save private material and drafts until a person claims them." },
} as const;
/** One /admin section. */
export type GroupId = keyof typeof GROUPS;

type Type = "string" | "secret" | "usd" | "int" | "ai-key" | "switch";
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
  meta_app_id: { group: "meta", label: "App ID", help: "From your app's dashboard on developers.facebook.com. Public.", type: "string", env: "META_APP_ID", default: null },
  meta_app_secret: { group: "meta", label: "App secret", help: "Signs every webhook Meta sends here, so a request without the right signature is refused. Stored encrypted, never shown again.", type: "secret", env: "META_APP_SECRET", default: null },
  meta_webhook_verify_token: { group: "meta", label: "Webhook verify token", help: "Any long random text. Paste the same text in your app's Webhooks settings; Meta sends it back once to confirm the address. Stored encrypted.", type: "secret", env: "META_WEBHOOK_VERIFY_TOKEN", default: null },
  agent_signup: { group: "agents", label: "Agent sign-up", help: "on or off. When off, POST /v1/agent/identity answers registration_disabled; agents already signed up keep working and can still be claimed.", type: "switch", env: "AGENT_SIGNUP", default: "off" },
} as const satisfies Record<string, Def>;

/** One operator setting. */
export type SettingKey = keyof typeof SETTINGS;

/** True only for the settings' own names, never for names every object inherits such as constructor. */
export const isSettingKey = (k: string): k is SettingKey => Object.hasOwn(SETTINGS, k);
/** Every setting, in registry order. */
const SETTING_KEYS: SettingKey[] = Object.keys(SETTINGS).filter(isSettingKey);

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
  switch: z.string().trim().toLowerCase().refine((s) => s === "on" || s === "off", "must be on or off"),
};

/** Parses what was typed for a setting into the form it is stored in, or says why it cannot be saved. */
export function parseSetting(key: SettingKey, input: string): { ok: true; value: string } | { ok: false; error: string } {
  const r = PARSERS[SETTINGS[key].type].safeParse(input);
  return r.success ? { ok: true, value: r.data } : { ok: false, error: `${SETTINGS[key].label} ${r.error.issues[0]?.message ?? "is not valid"}` };
}

/** One row per setting; secret values hold the encrypted form only. */
export type SettingsStore = {
  get(key: SettingKey): Promise<string | null>;
  /** True when the saved value was written before v0.8 and has not been saved or kept since. */
  legacy(key: SettingKey): Promise<boolean>;
  /** Saves a value; it wins over the server's environment. `by` is the admin's user id from the server session. */
  set(key: SettingKey, stored: string, by?: string): Promise<void>;
  /** Marks an older saved value as the operator's choice, so it wins too. False when there is no older value. */
  keep(key: SettingKey, by?: string): Promise<boolean>;
  remove(key: SettingKey, by?: string): Promise<void>;
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

/** True when a saved value is in use: saved in this release, or saved earlier and the environment sets nothing. */
async function savedWins(store: SettingsStore, key: SettingKey, fromEnv: string | null): Promise<boolean> {
  return fromEnv === null || !(await store.legacy(key));
}

/**
 * The working value of a setting: the one saved in /admin, else the environment's, else the default. A value saved
 * before v0.8 does not replace a set environment value until the operator chooses it in /admin.
 */
export async function resolveSetting(store: SettingsStore, key: SettingKey, masterKeyHex: string, env: Record<string, string | undefined> = process.env): Promise<Resolved> {
  const saved = await store.get(key);
  const fromEnv = envValue(key, env);
  if (saved !== null && (await savedWins(store, key, fromEnv))) return { value: isSecret(key) ? decryptSecret(saved, masterKeyHex) : saved, source: "saved" };
  if (fromEnv) return { value: fromEnv, source: "environment" };
  const fallback: string | null = SETTINGS[key].default;
  return fallback !== null ? { value: fallback, source: "default" } : null;
}

/** Settings with both a saved value and an environment value, split by whether the saved one is from before v0.8. */
async function conflicts(store: SettingsStore, env: Record<string, string | undefined>, legacy: boolean): Promise<SettingKey[]> {
  const keys = SETTING_KEYS;
  const hit = await Promise.all(keys.map(async (key) => envValue(key, env) !== null && (await store.get(key)) !== null && (await store.legacy(key)) === legacy));
  return keys.filter((_, i) => hit[i]);
}

/**
 * Settings whose value saved in /admin hides a value set in the server's environment, by the operator's choice.
 *
 * @param store - Where saved values live
 * @param env - The server's environment
 * @returns The setting keys, in registry order
 */
export function shadowedSettings(store: SettingsStore, env: Record<string, string | undefined> = process.env): Promise<SettingKey[]> {
  return conflicts(store, env, false);
}

/**
 * Settings with a value saved before v0.8 that the server's environment value holds back. The environment's value
 * stays in use until the operator saves the value again or chooses it in /admin.
 *
 * @param store - Where saved values live
 * @param env - The server's environment
 * @returns The setting keys, in registry order
 */
export function heldBackSettings(store: SettingsStore, env: Record<string, string | undefined> = process.env): Promise<SettingKey[]> {
  return conflicts(store, env, true);
}

/**
 * Logs, once, which settings have a saved value hiding the server's environment value, and which older saved values
 * the environment holds back. Names only, never values.
 *
 * @param store - Where saved values live
 * @param env - The server's environment
 */
export async function logShadowedSettings(store: SettingsStore, env: Record<string, string | undefined> = process.env): Promise<void> {
  const [shadowed, held] = await Promise.all([shadowedSettings(store, env), heldBackSettings(store, env)]);
  if (shadowed.length) console.warn(JSON.stringify({ event: "qp-setting-shadows-env", settings: shadowed, env: shadowed.map((k) => SETTINGS[k].env) }));
  if (held.length) console.warn(JSON.stringify({ event: "qp-setting-held-back", settings: held, env: held.map((k) => SETTINGS[k].env) }));
}

/**
 * Shape checks for values typed in /admin, beyond their type. Only a save is checked: a server environment value keeps
 * being read as before, so an existing deployment's "@name" still works (copies strip the @).
 */
const SAVE_CHECKS: Partial<Record<SettingKey, (v: string) => string | null>> = {
  telegram_bot_username: (v) => {
    if (v.startsWith("@")) return "Telegram bot username must be typed without the @";
    return /^[A-Za-z0-9_]{5,32}$/.test(v) && /bot$/i.test(v) ? null : "Telegram bot username must be 5 to 32 letters, digits or underscores, ending in \"bot\"";
  },
  discord_client_id: (v) => (/^\d{17,20}$/.test(v) ? null : "Discord application ID must be 17 to 20 digits"),
};

/**
 * Saves a setting from /admin after parsing it by its type; throws with the reason when it cannot be saved. `by` is the
 * admin's user id, taken from the server session by the caller, never from the form.
 */
export async function saveSetting(store: SettingsStore, key: SettingKey, input: string, masterKeyHex: string, by?: string): Promise<void> {
  const checked = checkSettingInput(key, input);
  if (!checked.ok) throw new Error(checked.error);
  await store.set(key, isSecret(key) ? encryptSecret(checked.value, masterKeyHex) : checked.value, by);
}

/**
 * Everything a save checks before writing: the type's parser, then the setting's own shape check. Lets a caller tell a
 * value the admin must fix apart from a store that failed.
 *
 * @param key - The setting
 * @param input - What was typed
 * @returns The value as it would be stored (before encryption), or the reason it cannot be saved
 */
export function checkSettingInput(key: SettingKey, input: string): { ok: true; value: string } | { ok: false; error: string } {
  const parsed = parseSetting(key, input);
  if (!parsed.ok) return parsed;
  const problem = SAVE_CHECKS[key]?.(parsed.value);
  return problem ? { ok: false, error: problem } : parsed;
}

/**
 * Makes a value saved before v0.8 the operator's choice, so it wins over the server's environment like a new save.
 *
 * @param store - Where saved values live
 * @param key - The setting
 * @param by - The admin's user id from the server session
 * @returns False when there is no older saved value to keep
 */
export function keepSavedSetting(store: SettingsStore, key: SettingKey, by?: string): Promise<boolean> {
  return store.keep(key, by);
}

/** Removes a saved setting; the server's environment value, else the default, then applies again. */
export function clearSetting(store: SettingsStore, key: SettingKey, by?: string): Promise<void> {
  return store.remove(key, by);
}

/** A saved value as typed: secrets are stored encrypted. */
const readable = (key: SettingKey, saved: string, masterKeyHex: string) => (isSecret(key) ? decryptSecret(saved, masterKeyHex) : saved);
/** A value as /admin shows it: secrets masked. */
const masked = (key: SettingKey, v: string) => (isSecret(key) ? maskSecret(v) : v);

/**
 * What /admin shows for each setting: every source in the order it is tried (saved here, server env, default), the one
 * in use marked, secrets masked. Each saved value is read and decrypted once.
 */
export async function describeSettings(store: SettingsStore, masterKeyHex: string, env: Record<string, string | undefined> = process.env) {
  return Promise.all(
    SETTING_KEYS.map(async (key) => {
      const def: Def = SETTINGS[key];
      const saved = await store.get(key);
      const legacy = saved !== null && (await store.legacy(key));
      const values: Record<Source, string | null> = {
        saved: saved === null ? null : readable(key, saved, masterKeyHex),
        environment: envValue(key, env),
        default: def.default,
      };
      const heldBack = legacy && values.environment !== null;
      const source = ORDER.find((k) => values[k] !== null && !(k === "saved" && heldBack)) ?? null;
      const shown = (v: string | null) => (v === null ? null : masked(key, v));
      return {
        key,
        group: def.group,
        label: def.label,
        help: def.help,
        type: def.type,
        env: def.env,
        source,
        display: source ? shown(values[source]) : null,
        /** True when the value saved here hides one set in the server's environment. */
        shadowsEnv: values.saved !== null && values.environment !== null && !legacy,
        /** True when the saved value is from before v0.8 and has not been saved or kept since. */
        legacy,
        /** True when that older saved value is not in use because the server's environment sets one. */
        heldBack,
        /** Every source in the order they are tried, with the one in use marked; a value set lower down is shown as ignored. */
        layers: ORDER.map((k) => ({ source: k, display: shown(values[k]), inUse: k === source })),
      };
    }),
  );
}

/** One setting as an admin operation lists it: never a secret's value, only whether one applies and from where. */
export type SettingState = { key: SettingKey; label: string; group: GroupId; secret: boolean; set: boolean; source: Source | null; value: string | null };

/**
 * Every setting's state without decrypting anything: whether a value applies, where it comes from (saved here, the
 * server's environment or the default, in the same order as resolveSetting), and the value itself only for settings
 * that are not secret.
 *
 * @param store - Where saved values live
 * @param env - The server's environment
 * @returns One entry per setting, in registry order
 */
export async function settingStates(store: SettingsStore, env: Record<string, string | undefined> = process.env): Promise<SettingState[]> {
  return Promise.all(
    SETTING_KEYS.map(async (key) => {
      const def: Def = SETTINGS[key];
      const saved = await store.get(key);
      const fromEnv = envValue(key, env);
      const usesSaved = saved !== null && (await savedWins(store, key, fromEnv));
      const values: Record<Source, string | null> = { saved, environment: fromEnv, default: def.default };
      const source = stateSource(usesSaved, fromEnv, def.default);
      const shown = source === null ? null : values[source];
      return { key, label: def.label, group: def.group, secret: isSecret(key), set: source !== null, source, value: isSecret(key) ? null : shown };
    }),
  );
}

/** Where a setting's state comes from, in resolveSetting's order; null when nothing applies. */
function stateSource(usesSaved: boolean, fromEnv: string | null, fallback: string | null): Source | null {
  if (usesSaved) return "saved";
  if (fromEnv !== null) return "environment";
  return fallback !== null ? "default" : null;
}

/** In-memory store for tests and local runs without a database. `legacyKeys` marks values saved before v0.8. */
export function memoryStore(): SettingsStore & { raw: Map<SettingKey, string>; legacyKeys: Set<SettingKey> } {
  const raw = new Map<SettingKey, string>();
  const legacyKeys = new Set<SettingKey>();
  return {
    raw,
    legacyKeys,
    get: async (k) => raw.get(k) ?? null,
    legacy: async (k) => raw.has(k) && legacyKeys.has(k),
    set: async (k, v) => { raw.set(k, v); legacyKeys.delete(k); },
    keep: async (k) => raw.has(k) && legacyKeys.delete(k),
    remove: async (k) => { raw.delete(k); legacyKeys.delete(k); },
  };
}
