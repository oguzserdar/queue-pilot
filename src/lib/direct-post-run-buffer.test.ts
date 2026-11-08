/**
 * @fileoverview Reading a followed Buffer post decides send or give up: published sends, a reminder post waits until
 * it is marked published, a deleted, failed or back-to-draft post gives up with the reason, and a read that cannot
 * happen throws so the due run waits instead of giving up. Every read is counted against the person's allowance.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ auth: {} as object | null, posts: [] as unknown[], budgeted: [] as string[] }));
vi.mock("server-only", () => ({}));
vi.mock("./auth", () => ({ getAuth: async () => state.auth }));
vi.mock("./buffer-token", () => ({ bufferAccessToken: async () => "token" }));
vi.mock("./buffer/queries", () => ({ readPostsNow: async () => state.posts }));
vi.mock("./buffer/budget", () => ({ withBudget: async (tool: string, _u: string, run: () => Promise<unknown>) => (state.budgeted.push(tool), { result: await run(), requests: 1 }) }));

const { readBufferState } = await import("./direct-post-run");
const post = (over: object) => ({ id: "bp1", status: "scheduled", dueAt: "2026-11-09T14:00:00Z", schedulingType: "automatic", notificationStatus: null, error: null, ...over });

beforeEach(() => { state.auth = {}; state.posts = []; state.budgeted = []; });

describe("readBufferState", () => {
  it("sends once Buffer published the post, counted against the person's allowance", async () => {
    state.posts = [post({ status: "sent" })];
    expect(await readBufferState("u1", "bp1")).toEqual({ state: "sent" });
    expect(state.budgeted).toEqual(["follow-up-check"]);
  });

  it("waits on a reminder post until the person marks it published", async () => {
    state.posts = [post({ status: "sent", schedulingType: "notification", notificationStatus: "pending" })];
    expect((await readBufferState("u1", "bp1")).state).toBe("waiting");
    state.posts = [post({ status: "sent", schedulingType: "notification", notificationStatus: "markedAsPublished" })];
    expect((await readBufferState("u1", "bp1")).state).toBe("sent");
  });

  it("gives up with the reason when the post was deleted, failed, or went back to drafts", async () => {
    state.posts = [];
    expect(await readBufferState("u1", "bp1")).toMatchObject({ state: "gone", reason: expect.stringMatching(/deleted/) });
    state.posts = [post({ status: "error", error: { message: "Token expired" } })];
    expect(await readBufferState("u1", "bp1")).toMatchObject({ state: "gone", reason: expect.stringMatching(/Token expired/) });
    state.posts = [post({ status: "draft" })];
    expect(await readBufferState("u1", "bp1")).toMatchObject({ state: "gone", reason: expect.stringMatching(/drafts/) });
  });

  it("waits, with Buffer's time, while the post is still scheduled", async () => {
    state.posts = [post({})];
    expect(await readBufferState("u1", "bp1")).toEqual({ state: "waiting", dueAt: new Date("2026-11-09T14:00:00Z") });
  });

  it("throws when Buffer sign-in is not set up, so the run waits instead of giving up", async () => {
    state.auth = null;
    await expect(readBufferState("u1", "bp1")).rejects.toThrow(/not set up/);
  });
});
