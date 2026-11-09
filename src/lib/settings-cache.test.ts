/**
 * @fileoverview The short in-process cache in front of operator settings: parallel readers share one lookup, a save
 * or removal in /admin shows at once, every server picks a change up within the cache's lifetime, and a failed read
 * is never kept.
 */
import { describe, expect, it, vi } from "vitest";
import { cachedOperatorSettings, createSettingsCache, SETTINGS_CACHE_MS } from "./env";
import { memoryStore, saveSetting } from "./settings";

const KEY = "0".repeat(64);

/** A store that counts how often a saved value is read. */
function countingStore() {
  const store = memoryStore();
  const get = vi.spyOn(store, "get");
  return { store, get };
}

describe("operator settings cache", () => {
  it("lets parallel readers share one lookup", async () => {
    const { store, get } = countingStore();
    await saveSetting(store, "exa_api_key", "saved-exa", KEY);
    get.mockClear();
    const cache = createSettingsCache();
    const src = { store, master: KEY, env: {} };
    const all = await Promise.all(Array.from({ length: 8 }, () => cachedOperatorSettings(["exa_api_key"], src, cache, 1000)));
    expect(all.every((r) => r.exa_api_key === "saved-exa")).toBe(true);
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("reads again after the cache's lifetime", async () => {
    const { store, get } = countingStore();
    const cache = createSettingsCache();
    const src = { store, master: KEY, env: { EXA_API_KEY: "from-env" } };
    expect((await cachedOperatorSettings(["exa_api_key"], src, cache, 1000)).exa_api_key).toBe("from-env");
    await cachedOperatorSettings(["exa_api_key"], src, cache, 1000 + SETTINGS_CACHE_MS - 1);
    expect(get).toHaveBeenCalledTimes(1);
    await cachedOperatorSettings(["exa_api_key"], src, cache, 1000 + SETTINGS_CACHE_MS + 1);
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("shows a value saved in /admin at once after the cache is cleared", async () => {
    const { store } = countingStore();
    const cache = createSettingsCache();
    const src = { store, master: KEY, env: { EXA_API_KEY: "from-env" } };
    expect((await cachedOperatorSettings(["exa_api_key"], src, cache, 1000)).exa_api_key).toBe("from-env");
    await saveSetting(store, "exa_api_key", "saved-exa", KEY);
    cache.clear();
    expect((await cachedOperatorSettings(["exa_api_key"], src, cache, 1001)).exa_api_key).toBe("saved-exa");
  });

  it("never keeps a failed read, so the next request tries the database again", async () => {
    const { store, get } = countingStore();
    get.mockRejectedValueOnce(new Error("database down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const cache = createSettingsCache();
    const src = { store, master: KEY, env: { EXA_API_KEY: "from-env" } };
    expect((await cachedOperatorSettings(["exa_api_key"], src, cache, 1000)).exa_api_key).toBe("from-env");
    await saveSetting(store, "exa_api_key", "saved-exa", KEY);
    expect((await cachedOperatorSettings(["exa_api_key"], src, cache, 1001)).exa_api_key).toBe("saved-exa");
  });
});
