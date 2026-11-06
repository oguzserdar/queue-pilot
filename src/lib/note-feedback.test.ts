/**
 * @fileoverview teamNotes: teammates' notes on open posts, newest first, each with its author and the post and account
 * it is on. Notes on an account that is not connected are left out, as are empty notes.
 */
import { describe, expect, it, vi } from "vitest";
import type { Channel, SentPost } from "./buffer/queries";

vi.mock("./written-store", () => ({ wroteIds: async () => new Set() }));
vi.mock("./feedback-flow", () => ({ checkedFeedback: vi.fn() }));
const { teamNotes, noteOrigin } = await import("./note-feedback");

const ch = (id: string, org: string): Channel => ({ id, name: `Account ${id}`, service: "linkedin", organizationId: org, timezone: "UTC", isDisconnected: false, isLocked: false, isQueuePaused: false, postingSchedule: [] });

describe("teamNotes", () => {
  it("reads each organization once and returns notes newest first with author, post and account", async () => {
    const read = vi.fn(async (_t: string, org: string): Promise<SentPost[]> => org === "o1"
      ? [{ id: "p1", channelId: "a", text: "Post one", sentAt: null, notes: [{ text: "Older note", by: "Sam", at: "2026-11-01T10:00:00Z" }, { text: "  ", by: "Sam", at: "2026-11-02T10:00:00Z" }] }]
      : [{ id: "p2", channelId: "b", text: "Post two", sentAt: null, notes: [{ text: "Newer note", by: null, at: "2026-11-03T10:00:00Z" }] }, { id: "p3", channelId: "gone", text: "x", sentAt: null, notes: [{ text: "On a disconnected account", by: "Sam", at: "2026-11-04T10:00:00Z" }] }]);
    const notes = await teamNotes({ token: "t", channels: [ch("a", "o1"), ch("b", "o2")] }, read);
    expect(read).toHaveBeenCalledTimes(2);
    expect(notes.map((n) => [n.text, n.author, n.account, n.postId])).toEqual([["Newer note", null, "Account b", "p2"], ["Older note", "Sam", "Account a", "p1"]]);
    expect(new Set(notes.map((n) => n.key)).size).toBe(2);
  });

  it("records a note's origin in words", () => {
    expect(noteOrigin({ author: "Sam", at: "2026-11-01T21:05:00Z" })).toBe("a note from Sam on 2026-11-01");
    expect(noteOrigin({ author: null, at: null })).toBe("a note from a teammate");
  });
});
