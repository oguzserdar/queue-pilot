/**
 * @fileoverview A saved built-in AI setting that cannot be decrypted (for example after SETTINGS_KEY changed) is logged
 * and skipped, so the server's environment values still apply, the same as every other setting read.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({ hasDatabase: () => true, postgresSettingsStore: () => ({ get: async (key: string) => (key === "fallback_ai_key" ? "not-a-ciphertext" : null), set: async () => {}, remove: async () => {} }) }));
vi.mock("./ai-allowance", async (original) => ({
  ...(await original<typeof import("./ai-allowance")>()),
  postgresAllowanceStore: () => ({ used: async () => ({ mine: 2, total: 2 }), spentMicros: async () => 0 }),
}));
const { allowanceFor } = await import("./judge-model");

afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("built-in AI settings that cannot be read", () => {
  it("falls back to the environment and logs, instead of turning built-in AI off", async () => {
    vi.stubEnv("SETTINGS_KEY", "c".repeat(64));
    vi.stubEnv("FALLBACK_AI_KEY", `sk-or-v1-${"ab".repeat(32)}`);
    vi.stubEnv("AI_BUDGET_USD", "50");
    vi.stubEnv("AI_CAP_PER_PERSON", "7");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await allowanceFor("u1")).toMatchObject({ used: 2, cap: 7, budgetUsd: 50 });
    expect(error.mock.calls.some(([line]) => String(line).includes("qp-settings-read-failed"))).toBe(true);
  });
});
