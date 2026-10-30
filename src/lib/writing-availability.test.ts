import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { shown, allowance, take } = vi.hoisted(() => ({ shown: vi.fn(), allowance: vi.fn(), take: vi.fn() }));
vi.mock("./ai-key-store", () => ({ postgresAiKeyStore: () => ({ shown }) }));
vi.mock("./judge-model", () => ({ allowanceFor: allowance, aiFor: take }));
import { writingAvailabilityFor } from "./writing-availability";

beforeEach(() => {
  vi.stubEnv("SETTINGS_KEY", "test-master");
  vi.clearAllMocks();
  shown.mockResolvedValue(null);
  allowance.mockResolvedValue({ used: 0, cap: 10, budgetUsd: 100, leftUsd: 100, totalRemaining: 100 });
});
afterEach(() => vi.unstubAllEnvs());

describe("writing availability", () => {
  it("enables the funded built-in writer without a personal key or taking an action", async () => {
    expect(await writingAvailabilityFor("person")).toEqual({ ready: true, source: "built-in AI" });
    expect(take).not.toHaveBeenCalled();
  });
  it("keeps a personal key independent of the shared allowance", async () => {
    shown.mockResolvedValue({ provider: "openai" });
    expect(await writingAvailabilityFor("person")).toEqual({ ready: true, source: "your key" });
    expect(allowance).not.toHaveBeenCalled();
  });
  it.each([null, { used: 10, cap: 10, leftUsd: 99, totalRemaining: 100 }, { used: 0, cap: 10, leftUsd: 0, totalRemaining: 100 }, { used: 0, cap: 10, leftUsd: 100, totalRemaining: 0 }])("does not promise unavailable built-in capacity: %j", async (value) => {
    allowance.mockResolvedValue(value);
    expect(await writingAvailabilityFor("person")).toMatchObject({ ready: false });
    expect(take).not.toHaveBeenCalled();
  });
  it("reports a read failure without treating it as a missing key", async () => {
    allowance.mockRejectedValue(new Error("unavailable"));
    expect(await writingAvailabilityFor("person")).toMatchObject({ ready: false, message: expect.stringContaining("Could not check") });
  });
});
