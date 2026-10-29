import { describe, expect, it } from "vitest";
import { describeSettings, GROUPS, memoryStore, parseSetting, resolveSetting, saveSetting, SETTINGS } from "./settings";

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

  it("lets the server's environment win over a saved value, then the saved value, then the default", async () => {
    const store = memoryStore();
    await saveSetting(store, "buffer_client_id", "from-admin", KEY);
    expect(await resolveSetting(store, "buffer_client_id", KEY, { BUFFER_CLIENT_ID: "from-env" })).toEqual({ value: "from-env", source: "environment" });
    expect(await resolveSetting(store, "buffer_client_id", KEY, {})).toEqual({ value: "from-admin", source: "saved" });
    expect(await resolveSetting(memoryStore(), "ai_cap_per_person", KEY, {})).toEqual({ value: "10", source: "default" });
    expect(await resolveSetting(memoryStore(), "fallback_ai_key", KEY, {})).toBeNull();
  });

  it("refuses an empty value instead of saving it", async () => {
    await expect(saveSetting(memoryStore(), "fallback_ai_key", "   ", KEY)).rejects.toThrow("cannot be empty");
  });

  it("shows secrets masked, and marks a setting the environment pins", async () => {
    const store = memoryStore();
    await saveSetting(store, "fallback_ai_key", "sk-ant-api03-abcdefghijwxyz", KEY);
    const rows = await describeSettings(store, KEY, { BUFFER_CLIENT_ID: "env-id" });
    expect(rows.find((r) => r.key === "fallback_ai_key")).toMatchObject({ display: "sk-ant-••••wxyz", source: "saved", pinned: false });
    expect(rows.find((r) => r.key === "buffer_client_secret")).toMatchObject({ display: null, source: null });
    expect(rows.find((r) => r.key === "buffer_client_id")).toMatchObject({ display: "env-id", source: "environment", pinned: true });
  });
  it("lists every source in priority order, so a saved value hidden by the server's shows as ignored", async () => {
    const store = memoryStore();
    await saveSetting(store, "ai_budget_usd", "50", KEY);
    const rows = await describeSettings(store, KEY, { AI_BUDGET_USD: "100" });
    expect(rows.find((r) => r.key === "ai_budget_usd")!.layers).toEqual([
      { source: "environment", display: "100.00", inUse: true },
      { source: "saved", display: "50.00", inUse: false },
      { source: "default", display: null, inUse: false },
    ]);
    const cap = (await describeSettings(memoryStore(), KEY, {})).find((r) => r.key === "ai_cap_per_person")!;
    expect(cap.layers.map((l) => l.inUse)).toEqual([false, false, true]);
  });
  it("masks a secret in every source", async () => {
    const store = memoryStore();
    await saveSetting(store, "fallback_ai_key", "sk-ant-api03-abcdefghijwxyz", KEY);
    const row = (await describeSettings(store, KEY, { FALLBACK_AI_KEY: "sk-ant-api03-zzzzzzzzzz1234" })).find((r) => r.key === "fallback_ai_key")!;
    expect(row.layers.slice(0, 2).map((l) => l.display)).toEqual(["sk-ant-••••1234", "sk-ant-••••wxyz"]);
  });
});

describe("typed settings", () => {
  it("reads a server environment value with the same parser as /admin, and ignores one it refuses", async () => {
    const store = memoryStore();
    expect(await resolveSetting(store, "ai_budget_usd", KEY, { AI_BUDGET_USD: "$400" })).toEqual({ value: "400.00", source: "environment" });
    await saveSetting(store, "ai_cap_per_person", "12", KEY);
    expect(await resolveSetting(store, "ai_cap_per_person", KEY, { AI_CAP_PER_PERSON: "ten" })).toEqual({ value: "12", source: "saved" });
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
