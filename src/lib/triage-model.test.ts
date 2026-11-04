/**
 * @fileoverview The home triage list: overdue drafts, the ones Buffer marks Overdue because their time passed while
 * they were still drafts, show in their own group with a link to Buffer.
 */
import { describe, expect, it } from "vitest";
import { TRIAGE_GROUPS, triageFromBuffer } from "./triage-model";

const now = new Date("2026-11-04T18:00:00Z");
const channel = { id: "x", name: "OguzSerdar", service: "twitter", timezone: "UTC", organizationId: "org", isDisconnected: false, isLocked: false, isQueuePaused: false, postingSchedule: [] };
const post = (id: string, status: string, dueAt: string | null, text = `Post ${id}`) => ({ id, channelId: "x", status, text, dueAt, sentAt: null, externalLink: null, error: null });
const triage = (posts: ReturnType<typeof post>[]) => triageFromBuffer({ channels: [channel] as never, posts: posts as never, now, timeZone: "UTC", checks: {}, comments: [] });

describe("triageFromBuffer overdue drafts", () => {
  it("lists drafts from the last seven days whose time passed, with when, where and a link to Buffer", () => {
    const items = triage([post("a", "draft", "2026-11-02T08:06:00Z", "One small edit isn't a writing rule.")]);
    expect(items).toEqual([{
      id: "overdue-a", kind: "overdue", title: "One small edit isn't a writing rule.", detail: "Mon 2 Nov, 08:06 · OguzSerdar",
      href: "https://publish.buffer.com", action: "Open Buffer", full: "One small edit isn't a writing rule.",
      why: "Its time passed while it was a draft, so Buffer did not post it. Pick a new time or delete it in Buffer.",
    }]);
  });

  it("leaves out scheduled and sent posts, drafts still ahead, and drafts older than the snapshot's seven days", () => {
    const items = triage([
      post("s", "scheduled", "2026-11-03T08:00:00Z"),
      post("t", "sent", "2026-11-03T09:00:00Z"),
      post("f", "draft", "2026-11-05T08:00:00Z"),
      post("old", "draft", "2026-10-20T08:00:00Z"),
      post("none", "draft", null),
    ]);
    expect(items.filter((i) => i.kind === "overdue")).toEqual([]);
  });

  it("puts the group right after posts that did not go out", () => {
    const kinds = TRIAGE_GROUPS.map((g) => g.kind);
    expect(kinds.indexOf("overdue")).toBe(kinds.indexOf("failed") + 1);
  });
});
