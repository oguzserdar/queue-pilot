import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WriteBuffer } from "./write-slots-for-user";
const deps = vi.hoisted(() => ({
  rewrites: vi.fn(), offers: vi.fn(), propose: vi.fn(), first: vi.fn(), sent: vi.fn(),
  settle: vi.fn(async () => {}), giveBack: vi.fn(async () => {}), ai: vi.fn(),
}));
vi.mock("./read-back", () => ({ currentRewrites: deps.rewrites, currentOffers: deps.offers }));
vi.mock("./rewrite-rules", () => ({ proposeRules: deps.propose }));
vi.mock("./day-one-rules", async original => ({ ...await original<typeof import("./day-one-rules")>(), proposeFirstRules: deps.first }));
vi.mock("./buffer/queries", () => ({ listRecentSent: deps.sent }));
vi.mock("./written-store", () => ({ wroteIds: async () => new Set(["ours"]) }));
vi.mock("./rules-store", () => ({ postgresRulesStore: () => ({ list: async () => [], dismissed: async () => new Set() }) }));
vi.mock("./judge-model", () => ({ judgeModelFor: deps.ai }));
const { ruleSuggestions, verifySuggestion } = await import("./rule-suggestions");
const rule = { kind: "guidance" as const, text: "Keep it short", channels: ["twitter"], level: "warn" as const };
const buffer = { userId: "a", token: "token", channels: [{ id: "ch", service: "twitter", organizationId: "org" }] } as WriteBuffer;
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv("SESSION_SECRET", "test-key");
  deps.ai.mockResolvedValue({ judges: { explainer: {}, decider: {} }, settle: deps.settle, giveBack: deps.giveBack });
});
afterEach(() => vi.unstubAllEnvs());
describe("learning controls", () => {
  it("does not spend an AI action without enough rewrites", async () => {
    deps.rewrites.mockResolvedValue({ rewrites: [], rules: [] });
    const r = await ruleSuggestions("a", "rewrites", async () => buffer);
    expect(r.suggestions).toHaveLength(0);
    expect(deps.ai).not.toHaveBeenCalled();
    expect(deps.rewrites).toHaveBeenCalledWith("a");
  });
  it("binds a proposed rewrite rule and its real evidence to its owner", async () => {
    const evidence = [1, 2].map(i => ({ postId: String(i), network: "twitter", before: "Long text", after: "Short" }));
    deps.rewrites.mockResolvedValue({ rewrites: evidence, rules: [] });
    deps.propose.mockResolvedValue([{ rule, evidence }]);
    const r = await ruleSuggestions("a", "rewrites", async () => buffer);
    expect(verifySuggestion("a", r.suggestions[0].token)?.evidence).toEqual(evidence);
    expect(verifySuggestion("b", r.suggestions[0].token)).toBeNull();
    expect(deps.settle).toHaveBeenCalledTimes(1);
  });
  it("excludes Queue Pilot posts from first-rule learning and gives back failed AI actions", async () => {
    deps.sent.mockResolvedValue([{ id: "ours", channelId: "ch", text: "Generated", notes: [] }, { id: "mine", channelId: "ch", text: "My writing", notes: [] }]);
    deps.first.mockResolvedValue({ offers: [{ rule, proof: { kind: "posts", examples: ["My writing"] } }], skipped: [] });
    const r = await ruleSuggestions("a", "past_posts", async () => buffer);
    expect(deps.first.mock.calls[0][2]).toEqual([{ id: "mine", network: "twitter", text: "My writing", notes: [] }]);
    expect(r.suggestions).toHaveLength(1);
    deps.first.mockRejectedValue(new Error("model failed"));
    await expect(ruleSuggestions("a", "past_posts", async () => buffer)).rejects.toThrow("model failed");
    expect(deps.giveBack).toHaveBeenCalledTimes(1);
    expect(deps.settle).toHaveBeenCalledTimes(2);
  });
});
