import { describe, expect, it, vi } from "vitest";
import { clearSetting, describeSettings, GROUPS, isSecret, logShadowedSettings, memoryStore, parseSetting, resolveSetting, saveSetting, SETTINGS, shadowedSettings } from "./settings";

const KEY = "c".repeat(64);

describe("operator settings", () => {
  it("stores secrets encrypted, never as typed", async () => {
    const store = memoryStore();
    await saveSetting(store, "buffer_client_secret", "  super-secret-value  ", KEY);
    expect(store.raw.get("buffer_client_secret")).not.toContain("super-secret-value");
    expect((await resolveSetting(store, "buffer_client_secret", KEY, {}))?.value).toBe("super-secret-value");
  });

  it("stores the non-secret client id as typed", async () => {
    const store = memoryStore();
    await saveSetting(store, "buffer_client_id", "cid-123", KEY);
    expect(store.raw.get("buffer_client_id")).toBe("cid-123");
  });

  it("lets a value saved in /admin win over the server's environment, then the environment, then the default", async () => {
    const store = memoryStore();
    await saveSetting(store, "buffer_client_id", "from-admin", KEY);
    expect(await resolveSetting(store, "buffer_client_id", KEY, { BUFFER_CLIENT_ID: "from-env" })).toEqual({ value: "from-admin", source: "saved" });
    expect(await resolveSetting(memoryStore(), "buffer_client_id", KEY, { BUFFER_CLIENT_ID: "from-env" })).toEqual({ value: "from-env", source: "environment" });
    expect(await resolveSetting(memoryStore(), "ai_cap_per_person", KEY, {})).toEqual({ value: "10", source: "default" });
    expect(await resolveSetting(memoryStore(), "fallback_ai_key", KEY, {})).toBeNull();
  });

  it("saves a secret over the server's value and goes back to it when the saved one is removed", async () => {
    const store = memoryStore();
    const env = { TELEGRAM_BOT_TOKEN: "env-token-1234" };
    await saveSetting(store, "telegram_bot_token", "saved-token-5678", KEY);
    expect(store.raw.get("telegram_bot_token")).not.toContain("saved-token-5678");
    expect(await resolveSetting(store, "telegram_bot_token", KEY, env)).toEqual({ value: "saved-token-5678", source: "saved" });
    await clearSetting(store, "telegram_bot_token");
    expect(await resolveSetting(store, "telegram_bot_token", KEY, env)).toEqual({ value: "env-token-1234", source: "environment" });
  });

  it("goes back to the default when a saved value is removed and the environment has none", async () => {
    const store = memoryStore();
    await saveSetting(store, "ai_cap_per_person", "25", KEY);
    expect(await resolveSetting(store, "ai_cap_per_person", KEY, {})).toEqual({ value: "25", source: "saved" });
    await clearSetting(store, "ai_cap_per_person");
    expect(await resolveSetting(store, "ai_cap_per_person", KEY, {})).toEqual({ value: "10", source: "default" });
  });

  it("keeps bootstrap values out of the registry, so they never live in the database", () => {
    const envs = Object.values(SETTINGS).map((s) => s.env as string);
    for (const bootstrap of ["SETTINGS_KEY", "SESSION_SECRET", "DATABASE_URL", "ADMIN_SETUP_CODE", "CRON_SECRET", "BUFFER_REDIRECT_URI", "TRUSTED_PROXIES"]) {
      expect(envs).not.toContain(bootstrap);
    }
  });

  it("lists the Telegram and Discord bot settings, with the tokens and client secret kept secret", () => {
    expect(Object.values(SETTINGS).filter((s) => s.group === "copies").map((s) => s.env)).toEqual(["TELEGRAM_BOT_TOKEN", "TELEGRAM_BOT_USERNAME", "DISCORD_CLIENT_ID", "DISCORD_CLIENT_SECRET", "DISCORD_BOT_TOKEN"]);
    expect(["telegram_bot_token", "discord_client_secret", "discord_bot_token"].every((k) => isSecret(k as keyof typeof SETTINGS))).toBe(true);
    expect(isSecret("discord_client_id")).toBe(false);
  });

  it("refuses an empty value instead of saving it", async () => {
    await expect(saveSetting(memoryStore(), "fallback_ai_key", "   ", KEY)).rejects.toThrow("cannot be empty");
  });

  it("shows secrets masked, and says where each value comes from", async () => {
    const store = memoryStore();
    await saveSetting(store, "fallback_ai_key", "sk-ant-api03-abcdefghijwxyz", KEY);
    const rows = await describeSettings(store, KEY, { BUFFER_CLIENT_ID: "env-id" });
    expect(rows.find((r) => r.key === "fallback_ai_key")).toMatchObject({ display: "sk-ant-••••wxyz", source: "saved" });
    expect(rows.find((r) => r.key === "buffer_client_secret")).toMatchObject({ display: null, source: null });
    expect(rows.find((r) => r.key === "buffer_client_id")).toMatchObject({ display: "env-id", source: "environment" });
  });
  it("lists every source in priority order, so the server's value under a saved one shows as ignored", async () => {
    const store = memoryStore();
    await saveSetting(store, "ai_budget_usd", "50", KEY);
    const rows = await describeSettings(store, KEY, { AI_BUDGET_USD: "100" });
    expect(rows.find((r) => r.key === "ai_budget_usd")!.layers).toEqual([
      { source: "saved", display: "50.00", inUse: true },
      { source: "environment", display: "100.00", inUse: false },
      { source: "default", display: null, inUse: false },
    ]);
    const cap = (await describeSettings(memoryStore(), KEY, {})).find((r) => r.key === "ai_cap_per_person")!;
    expect(cap.layers.map((l) => l.inUse)).toEqual([false, false, true]);
  });
  it("masks a secret in every source", async () => {
    const store = memoryStore();
    await saveSetting(store, "fallback_ai_key", "sk-ant-api03-abcdefghijwxyz", KEY);
    const row = (await describeSettings(store, KEY, { FALLBACK_AI_KEY: "sk-ant-api03-zzzzzzzzzz1234" })).find((r) => r.key === "fallback_ai_key")!;
    expect(row.layers.slice(0, 2).map((l) => l.display)).toEqual(["sk-ant-••••wxyz", "sk-ant-••••1234"]);
  });
});

describe("typed settings", () => {
  it("reads a server environment value with the same parser as /admin, and ignores one it refuses", async () => {
    const store = memoryStore();
    expect(await resolveSetting(store, "ai_budget_usd", KEY, { AI_BUDGET_USD: "$400" })).toEqual({ value: "400.00", source: "environment" });
    expect(await resolveSetting(store, "ai_cap_per_person", KEY, { AI_CAP_PER_PERSON: "ten" })).toEqual({ value: "10", source: "default" });
  });
  it("reads a dollar amount with at most two decimals and refuses anything else", () => {
    expect(parseSetting("ai_budget_usd", "400")).toEqual({ ok: true, value: "400.00" });
    expect(parseSetting("ai_budget_usd", "$1,250.5")).toEqual({ ok: true, value: "1250.50" });
    for (const bad of ["abc", "-5", "1.234"]) expect(parseSetting("ai_budget_usd", bad).ok).toBe(false);
  });
  it("reads a whole number of zero or more", () => {
    expect(parseSetting("ai_cap_per_person", " 15 ")).toEqual({ ok: true, value: "15" });
    for (const bad of ["1.5", "-1", "ten"]) expect(parseSetting("ai_cap_per_person", bad).ok).toBe(false);
  });
  it("checks that a key has the shape its provider gives it", () => {
    expect(parseSetting("fallback_ai_key", "not-a-key").ok).toBe(false);
    expect(parseSetting("fallback_ai_key", `sk-or-v1-${"ab".repeat(32)}`).ok).toBe(true);
  });
  it("saves the parsed form, so a budget typed as $400 is stored as 400.00", async () => {
    const store = memoryStore();
    await saveSetting(store, "ai_budget_usd", "$400", KEY);
    expect(store.raw.get("ai_budget_usd")).toBe("400.00");
    await expect(saveSetting(store, "ai_budget_usd", "lots", KEY)).rejects.toThrow(/dollar/i);
  });
  it("puts every setting in a known section, with help text", () => {
    for (const [key, def] of Object.entries(SETTINGS)) {
      expect(GROUPS, key).toHaveProperty(def.group);
      expect(def.help.length, key).toBeGreaterThan(10);
    }
  });
});

describe("saved values that hide the server's environment", () => {
  it("finds every saved value that hides a set environment value", async () => {
    const store = memoryStore();
    await saveSetting(store, "fallback_ai_key", "sk-ant-api03-oldoldoldold", KEY);
    await saveSetting(store, "ai_cap_per_person", "50", KEY);
    await saveSetting(store, "exa_api_key", "exa-saved-value", KEY);
    const env = { FALLBACK_AI_KEY: "sk-ant-api03-newnewnewnew", AI_CAP_PER_PERSON: "5", BUFFER_CLIENT_ID: "env-only" };
    expect(await shadowedSettings(store, env)).toEqual(["fallback_ai_key", "ai_cap_per_person"]);
    expect(await shadowedSettings(memoryStore(), env)).toEqual([]);
    const rows = await describeSettings(store, KEY, env);
    expect(rows.filter((r) => r.shadowsEnv).map((r) => r.key)).toEqual(["fallback_ai_key", "ai_cap_per_person"]);
  });

  it("logs the setting keys once at startup, never their values", async () => {
    const store = memoryStore();
    await saveSetting(store, "fallback_ai_key", "sk-ant-api03-oldoldoldold", KEY);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await logShadowedSettings(store, { FALLBACK_AI_KEY: "sk-ant-api03-newnewnewnew" });
      expect(warn).toHaveBeenCalledTimes(1);
      const line = String(warn.mock.calls[0][0]);
      expect(JSON.parse(line)).toEqual({ event: "qp-setting-shadows-env", settings: ["fallback_ai_key"], env: ["FALLBACK_AI_KEY"] });
      expect(line).not.toContain("oldold");
      expect(line).not.toContain("newnew");
      warn.mockClear();
      await logShadowedSettings(memoryStore(), { FALLBACK_AI_KEY: "sk-ant-api03-newnewnewnew" });
      expect(warn).not.toHaveBeenCalled();
    } finally { warn.mockRestore(); }
  });
});
