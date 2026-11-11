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

describe("triageFromBuffer empty times", () => {
  // Three posting times a day, every day: 21 empty times next week.
  const busy = { ...channel, postingSchedule: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((day) => ({ day, paused: false, times: ["09:00", "13:00", "17:00"] })) };
  const empties = (posts: ReturnType<typeof post>[]) => triageFromBuffer({ channels: [busy] as never, posts: posts as never, now, timeZone: "UTC", checks: {}, comments: [] }).filter((i) => i.kind === "empty");

  it("is one line with the count, never one per time", () => {
    const rows = empties([]);
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe("21 empty times next week");
    expect(rows[0].href).toBe("/week");
  });
  it("counts down as times are filled and disappears when none is left empty", () => {
    // Next week from Wed 4 Nov 2026 is Mon 9 to Sun 15 Nov.
    expect(empties([post("a", "draft", "2026-11-09T09:00:00Z")])[0].title).toBe("20 empty times next week");
    expect(triageFromBuffer({ channels: [channel] as never, posts: [] as never, now, timeZone: "UTC", checks: {}, comments: [] }).some((i) => i.kind === "empty")).toBe(false);
  });
});

describe("triageFromBuffer repeated fixes", () => {
  const withRepeats = (repeats: { channelId?: string; network: string; count: number }[]) => triageFromBuffer({ channels: [channel] as never, posts: [], now, timeZone: "UTC", checks: {}, comments: [], repeats }).filter((i) => i.kind === "repeat");

  it("shows nothing when no fix was repeated", () => {
    expect(withRepeats([])).toEqual([])
    expect(triageFromBuffer({ channels: [channel] as never, posts: [], now, timeZone: "UTC", checks: {}, comments: [] }).filter((i) => i.kind === "repeat")).toEqual([])
  })

  it("is one line that opens the offer on the Playbook, saying where the fix was made", () => {
    expect(withRepeats([{ channelId: "x", network: "twitter", count: 2 }])).toEqual([{ id: "repeat-fixes", kind: "repeat", title: "You made the same fix in 2 drafts", detail: "OguzSerdar · X", href: "/playbook#fixes", action: "See the rule" }])
  })

  it("stays one line for several repeats", () => {
    const rows = withRepeats([{ channelId: "x", network: "twitter", count: 3 }, { channelId: "x", network: "twitter", count: 2 }])
    expect(rows).toHaveLength(1)
    expect(rows[0].title).toBe("You repeated 2 fixes in your drafts")
  })

  it("comes first on Home, above drafts", () => {
    expect(TRIAGE_GROUPS[0]).toEqual({ kind: "repeat", label: "Fixes you repeated" })
  })
});
