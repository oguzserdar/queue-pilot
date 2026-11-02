import { describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ blocked: new Map<string, string>([["p", "Source changed; check evidence."]]), schedule: vi.fn() }));
vi.mock("./source-store", () => ({ sourceHoldsForPosts: async () => state.blocked }));
vi.mock("./written-store", () => ({ postgresWrittenStore: () => ({ get: async () => [{ postId: "p", text: "Draft", network: "twitter", verdicts: [] }] }) }));
vi.mock("./rules-store", () => ({ postgresRulesStore: () => ({ list: async () => [] }) }));
vi.mock("./approve-drafts", () => ({ approveDrafts: (...args: unknown[]) => state.schedule(...args) }));
const { approveChecked } = await import("./approve-checked");
it("source change blocks approval even when the playbook has no rules", async () => {
  const posts = [{ id: "p", text: "Draft", status: "draft", channelId: "ch" }] as never;
  const result = await approveChecked("u", "token", ["p"], new Date(), undefined, posts);
  expect(result.refused).toEqual([{ id: "p", reason: "Source changed; check evidence." }]);
  expect(state.schedule).not.toHaveBeenCalled();
});
