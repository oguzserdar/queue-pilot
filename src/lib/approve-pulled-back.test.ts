/**
 * @fileoverview A post the person took off the schedule in Buffer is scheduled again only by the person, one post at a
 * time: never in "Approve all", never by an AI app (whatever its setting).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ pulled: new Set<string>(), schedule: vi.fn<(ids: string[]) => void>() }));
vi.mock("./source-store", () => ({ sourceHoldsForPosts: async () => new Map() }));
vi.mock("./written-store", () => ({ postgresWrittenStore: () => ({ get: async (_u: string, ids: string[]) => ids.map((postId) => ({ postId, text: "Draft", network: "twitter", verdicts: [] })) }) }));
vi.mock("./rules-store", () => ({ postgresRulesStore: () => ({ list: async () => [] }) }));
vi.mock("./pulled-back", () => ({ pulledBackFor: async () => new Set(state.pulled) }));
vi.mock("./approve-drafts", () => ({ approveDrafts: async (_t: string, ids: string[]) => { state.schedule(ids); return { approved: ids, refused: [] }; } }));
const { approveChecked, PULLED_BACK_AI, PULLED_BACK_BULK } = await import("./approve-checked");

const posts = ["back", "fresh"].map((id) => ({ id, text: "Draft", status: "draft", channelId: "ch" })) as never;
beforeEach(() => { state.pulled = new Set(["back"]); state.schedule.mockClear(); });

describe("approving a post the person pulled back in Buffer", () => {
  it("leaves it out of approving many at once, and schedules the others", async () => {
    const r = await approveChecked("u", "t", ["back", "fresh"], new Date(), undefined, posts);
    expect(r.approved).toEqual(["fresh"]);
    expect(r.refused).toEqual([{ id: "back", reason: PULLED_BACK_BULK }]);
  });

  it("refuses an AI app, with its own reason", async () => {
    const r = await approveChecked("u", "t", ["back"], new Date(), undefined, posts, undefined, "ai");
    expect(r.approved).toEqual([]);
    expect(r.refused).toEqual([{ id: "back", reason: PULLED_BACK_AI }]);
    expect(state.schedule).not.toHaveBeenCalled();
  });

  it("schedules it when the person approves that one post", async () => {
    const r = await approveChecked("u", "t", ["back"], new Date(), undefined, posts, undefined, "one");
    expect(r.approved).toEqual(["back"]);
  });

  it("control: with no pulled-back posts, approving many schedules all", async () => {
    state.pulled = new Set();
    expect((await approveChecked("u", "t", ["back", "fresh"], new Date(), undefined, posts)).approved).toEqual(["back", "fresh"]);
  });
});
