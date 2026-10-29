import { describe, expect, it } from "vitest";
import type { Channel, Post } from "./buffer/queries";
import { openSlots, parseSlotId, slotId } from "./open-slots";
import { knownRange } from "./open-slots";

const channel = (over: Partial<Channel> = {}): Channel => ({
  id: "x1",
  name: "X",
  service: "twitter",
  timezone: "Europe/London",
  isDisconnected: false,
  isLocked: false,
  isQueuePaused: false,
  postingSchedule: [
    { day: "mon", paused: false, times: ["09:00"] },
    { day: "tue", paused: false, times: ["09:00", "15:00"] },
  ],
  organizationId: "org1",
  ...over,
});

const post = (over: Partial<Post>): Post => ({
  id: "p1",
  channelId: "x1",
  status: "scheduled",
  text: "hi",
  dueAt: null,
  sentAt: null,
  externalLink: null,
  error: null,
  ...over,
});

// Mon 2 Nov 2026 00:00 London (GMT) to Mon 9 Nov.
const range = { start: new Date("2026-11-02T00:00:00Z"), end: new Date("2026-11-09T00:00:00Z") };

describe("openSlots", () => {
  it("lists every posting slot in the week when the queue is empty", () => {
    const { slots, skipped } = openSlots([channel()], [], range);
    expect(slots.map((s) => s.at)).toEqual(["2026-11-02T09:00:00.000Z", "2026-11-03T09:00:00.000Z", "2026-11-03T15:00:00.000Z"]);
    expect(slots[0]).toMatchObject({ channel: "X", service: "twitter", organizationId: "org1", local: "Mon 2 Nov 09:00" });
    expect(skipped).toEqual([]);
  });

  it("leaves out slots that already hold a post, but reopens a slot whose post failed", () => {
    const posts = [
      post({ id: "a", dueAt: "2026-11-02T09:00:00.000Z", status: "scheduled" }),
      post({ id: "b", dueAt: "2026-11-03T09:00:20.000Z", status: "draft" }),
      post({ id: "c", dueAt: "2026-11-03T15:00:00.000Z", status: "error" }),
    ];
    expect(openSlots([channel()], posts, range).slots.map((s) => s.at)).toEqual(["2026-11-03T15:00:00.000Z"]);
  });

  it("does not count another channel's post against this channel's slot", () => {
    const posts = [post({ channelId: "other", dueAt: "2026-11-02T09:00:00.000Z" })];
    expect(openSlots([channel()], posts, range).slots).toHaveLength(3);
  });

  it("uses the channel's own timezone", () => {
    const ny = channel({ id: "n1", name: "LinkedIn", timezone: "America/New_York", postingSchedule: [{ day: "mon", paused: false, times: ["09:00"] }] });
    expect(openSlots([ny], [], range).slots[0]).toMatchObject({ at: "2026-11-02T14:00:00.000Z", local: "Mon 2 Nov 09:00", timezone: "America/New_York" });
  });

  it("skips channels Buffer cannot post to, with the reason", () => {
    const { slots, skipped } = openSlots(
      [channel({ id: "d", name: "Bluesky", isDisconnected: true }), channel({ id: "p", name: "Threads", isQueuePaused: true })],
      [],
      range,
    );
    expect(slots).toEqual([]);
    expect(skipped).toEqual([
      { channel: "Bluesky", reason: "disconnected in Buffer" },
      { channel: "Threads", reason: "queue paused in Buffer" },
    ]);
  });

  it("round-trips slot ids, including channel ids that contain @", () => {
    expect(parseSlotId(slotId("a@b", "2026-11-02T09:00:00.000Z"))).toEqual({ channelId: "a@b", at: "2026-11-02T09:00:00.000Z" });
    expect(parseSlotId("nonsense")).toBeNull();
    expect(parseSlotId("x1@not-a-date")).toBeNull();
  });
});

describe("knownRange", () => {
  const now = new Date("2026-11-01T00:00:00Z");
  it("covers 14 days when the copy is complete and fresh", () => {
    const r = knownRange({ posts: [], truncated: false, range: { end: "2026-11-20T00:00:00Z" } }, now);
    expect(r.end).toEqual(new Date("2026-11-15T00:00:00Z"));
    expect(r.note).toBeNull();
  });
  it("ends where an older copy's range ends", () => {
    expect(knownRange({ posts: [], range: { end: "2026-11-10T00:00:00Z" } }, now).end).toEqual(new Date("2026-11-10T00:00:00Z"));
  });
  it("ends at the last post read when Buffer had more posts than one read takes, and says so", () => {
    const r = knownRange({ posts: [{ dueAt: "2026-11-05T09:00:00Z" }, { dueAt: "2026-11-04T09:00:00Z" }], truncated: true, range: { end: "2026-11-20T00:00:00Z" } }, now);
    expect(r.end).toEqual(new Date("2026-11-05T09:00:00Z"));
    expect(r.note).toContain("2026-11-05 09:00 UTC");
  });
});
