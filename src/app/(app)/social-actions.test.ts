/**
 * @fileoverview The Settings actions for social accounts: signed out is refused, the replies switch and disconnect act
 * only on the signed-in person's own account, and a Bluesky refusal comes back as the person's words, never a throw.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const user = vi.hoisted(() => ({ id: "u1" as string | null }));
const lib = vi.hoisted(() => ({ connectBluesky: vi.fn<typeof import("@/lib/social-connect").connectBluesky>(), disconnectSocialAccount: vi.fn<typeof import("@/lib/social-connect").disconnectSocialAccount>(), setReplies: vi.fn<typeof import("@/lib/social-accounts").setReplies>(), setPostingTimes: vi.fn<typeof import("@/lib/posting-times").setPostingTimes>() }));
vi.mock("@/lib/current-user", () => ({ signedInUserId: async () => user.id }));
vi.mock("@/lib/rate-limit", () => ({ limit: async () => ({ ok: true }) }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/social-accounts", () => ({ setReplies: lib.setReplies }));
vi.mock("@/lib/posting-times", async (orig) => ({ parsePostingTimes: (await orig<typeof import("@/lib/posting-times")>()).parsePostingTimes, setPostingTimes: lib.setPostingTimes }));
vi.mock("server-only", () => ({}));
vi.mock("@/db", () => ({ db: () => { throw new Error("no database in this test"); } }));
vi.mock("@/lib/social-connect", () => {
  class ConnectError extends Error { constructor(m: string, readonly code: string) { super(m); } }
  return { ConnectError, connectBluesky: lib.connectBluesky, disconnectSocialAccount: lib.disconnectSocialAccount };
});
vi.stubEnv("SETTINGS_KEY", "22".repeat(32));
const { connectBlueskyAction, disconnectSocialAction, setPostingTimesAction, setRepliesAction } = await import("./social-actions");

beforeEach(() => { user.id = "u1"; for (const f of Object.values(lib)) f.mockReset(); });

describe("social account actions", () => {
  it("refuses a signed-out person and calls nothing", async () => {
    user.id = null;
    expect((await setRepliesAction("acc", true)).ok).toBe(false);
    expect((await disconnectSocialAction("acc")).ok).toBe(false);
    expect((await connectBlueskyAction({ handle: "ada.bsky.social", appPassword: "x" })).ok).toBe(false);
    expect(lib.setReplies).not.toHaveBeenCalled();
    expect(lib.disconnectSocialAccount).not.toHaveBeenCalled();
    expect(lib.connectBluesky).not.toHaveBeenCalled();
  });

  it("switches replies for the signed-in person's account only", async () => {
    lib.setReplies.mockResolvedValue("ok");
    expect((await setRepliesAction("acc-1", true)).ok).toBe(true);
    expect(lib.setReplies).toHaveBeenCalledWith("u1", "acc-1", true);
  });

  it("answers an account that is not the person's as not found", async () => {
    lib.setReplies.mockResolvedValue("not-found");
    lib.disconnectSocialAccount.mockResolvedValue(false);
    expect(await setRepliesAction("someone-else", true)).toMatchObject({ ok: false });
    expect(await disconnectSocialAction("someone-else")).toMatchObject({ ok: false });
    expect(lib.disconnectSocialAccount.mock.calls[0][0]).toBe("u1");
  });

  it("returns a Bluesky refusal as the person's words", async () => {
    const { ConnectError } = await import("@/lib/social-connect");
    lib.connectBluesky.mockRejectedValue(new ConnectError("That is your account password.", "main-password"));
    expect(await connectBlueskyAction({ handle: "ada.bsky.social", appPassword: "hunter2" })).toEqual({ ok: false, message: "That is your account password." });
  });

  it("connects Bluesky for the signed-in person", async () => {
    lib.connectBluesky.mockResolvedValue({ handle: "ada.bsky.social" });
    expect(await connectBlueskyAction({ handle: "ada.bsky.social", appPassword: "abcd-efgh-ijkl-mnop" })).toEqual({ ok: true, message: "Connected ada.bsky.social." });
    expect(lib.connectBluesky.mock.calls[0][0]).toBe("u1");
  });
});

describe("setPostingTimesAction", () => {
  const week = [{ day: "mon", times: ["17:30", "09:00"] }];
  it("refuses a signed-out person and saves nothing", async () => {
    user.id = null;
    expect(await setPostingTimesAction("acc", week, "UTC")).toEqual({ ok: false, message: "Sign in first." });
    expect(lib.setPostingTimes).not.toHaveBeenCalled();
  });
  it("saves the cleaned week for the signed-in person and says how many times", async () => {
    lib.setPostingTimes.mockResolvedValue("ok");
    expect(await setPostingTimesAction("acc", week, "UTC")).toEqual({ ok: true, message: "Saved 2 posting times a week." });
    expect(lib.setPostingTimes).toHaveBeenCalledWith("u1", "acc", { ok: true, schedule: [{ day: "mon", paused: false, times: ["09:00", "17:30"] }], timeZone: "UTC" });
  });
  it("answers a bad time in plain words without saving", async () => {
    expect((await setPostingTimesAction("acc", [{ day: "mon", times: ["9am"] }], "UTC")).message).toMatch(/24-hour clock/);
    expect(lib.setPostingTimes).not.toHaveBeenCalled();
  });
  it("answers someone else's account as not connected", async () => {
    lib.setPostingTimes.mockResolvedValue("not-found");
    expect((await setPostingTimesAction("theirs", week, "UTC")).ok).toBe(false);
  });
});
