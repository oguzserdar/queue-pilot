/**
 * @fileoverview Server start logs which saved settings hide the server's environment values, by name only.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { memoryStore, saveSetting } from "./lib/settings";

const store = memoryStore();
vi.mock("./lib/db", () => ({ hasDatabase: () => true, postgresSettingsStore: () => store }));

afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("server start", () => {
  it("logs a saved setting that hides the environment's value", async () => {
    await saveSetting(store, "ai_cap_per_person", "50", "c".repeat(64));
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("AI_CAP_PER_PERSON", "5");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { register } = await import("./instrumentation");
    await register();
    await vi.waitFor(() => expect(warn).toHaveBeenCalledTimes(1));
    expect(JSON.parse(String(warn.mock.calls[0][0]))).toMatchObject({ event: "qp-setting-shadows-env", settings: ["ai_cap_per_person"] });
  });

  it("logs the real cause when the check fails, not only the wrapper's message", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("AI_CAP_PER_PERSON", "5");
    const wrapped = Object.assign(new Error('Failed query: select coalesce(max("id"), 0)::int from "qp_settings_audit"'), { cause: Object.assign(new Error("Connection terminated unexpectedly"), { code: "57P01" }) });
    vi.spyOn(store, "get").mockRejectedValue(wrapped);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { register } = await import("./instrumentation");
    await register();
    await vi.waitFor(() => expect(error).toHaveBeenCalled());
    expect(JSON.parse(String(error.mock.calls[0][0]))).toMatchObject({ event: "qp-setting-shadows-check-failed", cause: "Connection terminated unexpectedly", code: "57P01" });
  });
});
