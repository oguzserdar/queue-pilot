import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ cards: [] as unknown[], pending: 0, buffer: { userId: "owner", token: "token", posts: [{ id: "post", text: "Original", status: "draft" }] }, edit: vi.fn(async () => ({ ok: true })), report: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/current-user", () => ({ signedInUserId: async () => "owner", freshBufferForCurrentUser: async () => state.buffer }));
vi.mock("@/lib/buffer/queries", () => ({ readPostsNow: async () => state.buffer.posts }));
vi.mock("@/lib/check-sources", () => ({ checkSources: vi.fn() }));
vi.mock("@/lib/source-check", () => ({ listSourcesToCheck: async () => [{ sourceKey: "source", evidence: [{ postId: "post" }] }], reportSourceVersion: async (...args: unknown[]) => { state.report(...args); return { pending: state.pending }; } }));
vi.mock("@/lib/source-store", () => ({ latestSource: async () => ({ uri: "https://example.com/source", text: "Actual source", metadata: {} }) }));
vi.mock("@/lib/source-presentation", () => ({ sourceCards: async () => state.cards }));
vi.mock("@/lib/rate-limit", () => ({ limit: async () => ({ ok: true }) }));
vi.mock("./actions", () => ({ editDraftText: (...args: unknown[]) => state.edit(...args as []) }));
const { recheckSourceEvidence, applySourceFix } = await import("./source-actions");
beforeEach(() => { state.cards = []; state.pending = 0; state.edit.mockClear(); state.report.mockClear(); });
it("does not report an unfinished evidence check as successful", async () => {
  state.pending = 1;
  expect(await recheckSourceEvidence("post")).toMatchObject({ ok: false, message: expect.stringContaining("unfinished") });
});
it("will not apply a proposal to a scheduled post or a missing proposal", async () => {
  state.cards = [{ postId: "post", snapshotId: "source", rewrite: "New", scheduled: true }];
  expect((await applySourceFix("post", "source")).ok).toBe(false);
  expect((await applySourceFix("other", "source")).ok).toBe(false);
  expect(state.edit).not.toHaveBeenCalled();
});
it("uses the server-stored proposal and exact prior text for the existing edit guard", async () => {
  state.cards = [{ postId: "post", snapshotId: "source", rewrite: "Supported correction", draftText: "Original", scheduled: false, editable: true, needsCheck: false }];
  expect((await applySourceFix("post", "source")).ok).toBe(true);
  expect(state.edit).toHaveBeenCalledWith("post", "Supported correction", "Original");
  expect(state.report).toHaveBeenCalledWith("owner", expect.objectContaining({ sourceKey: "source", text: "Actual source", checkedBy: "user" }), expect.any(Function), {});
});
