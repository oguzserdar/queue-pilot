import { describe, expect, it } from "vitest";
import { openSlots, slotsInRange, zonedToUtc } from "./slots";

const ch = (timezone: string, schedule: { day: "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun"; paused?: boolean; times: string[] }[], isQueuePaused = false) => ({
  id: "c1",
  timezone,
  isQueuePaused,
  postingSchedule: schedule.map((s) => ({ day: s.day, paused: s.paused ?? false, times: s.times })),
});

// Mon 2 Nov 2026 00:00 UTC to Mon 9 Nov 2026 00:00 UTC.
const START = new Date("2026-11-02T00:00:00Z");
const END = new Date("2026-11-09T00:00:00Z");

describe("zonedToUtc", () => {
  it("converts New York wall time to UTC in winter (UTC-5)", () => {
    expect(zonedToUtc(2026, 11, 2, 9, 0, "America/New_York").toISOString()).toBe("2026-11-02T14:00:00.000Z");
  });
  it("converts New York wall time to UTC in summer (UTC-4)", () => {
    expect(zonedToUtc(2026, 7, 6, 9, 0, "America/New_York").toISOString()).toBe("2026-07-06T13:00:00.000Z");
  });
  it("handles a clock-change day: US clocks go back on Sun 1 Nov 2026", () => {
    expect(zonedToUtc(2026, 11, 1, 9, 0, "America/New_York").toISOString()).toBe("2026-11-01T14:00:00.000Z");
  });
});

describe("slotsInRange", () => {
  it("expands weekly times in the channel's timezone", () => {
    const s = slotsInRange(ch("Europe/Istanbul", [{ day: "mon", times: ["09:00", "18:00"] }, { day: "wed", times: ["12:00"] }]), START, END);
    expect(s.map((x) => x.at)).toEqual(["2026-11-02T06:00:00.000Z", "2026-11-02T15:00:00.000Z", "2026-11-04T09:00:00.000Z"]);
  });
  it("skips paused days and returns nothing for a paused queue", () => {
    expect(slotsInRange(ch("UTC", [{ day: "tue", paused: true, times: ["09:00"] }]), START, END)).toEqual([]);
    expect(slotsInRange(ch("UTC", [{ day: "tue", times: ["09:00"] }], true), START, END)).toEqual([]);
  });
  it("keeps a late-evening slot far west of UTC that lands on the next UTC day", () => {
    const s = slotsInRange(ch("America/Los_Angeles", [{ day: "sun", times: ["20:00"] }]), START, END);
    // Sun 1 Nov 20:00 PST (clocks fell back that morning) = Mon 2 Nov 04:00 UTC: inside the range.
    // Sun 8 Nov 20:00 PST = Mon 9 Nov 04:00 UTC: outside it.
    expect(s.map((x) => x.at)).toEqual(["2026-11-02T04:00:00.000Z"]);
    const s2 = slotsInRange(ch("America/Los_Angeles", [{ day: "sat", times: ["20:00"] }]), START, END);
    expect(s2.map((x) => x.at)).toEqual(["2026-11-08T04:00:00.000Z"]);
  });
});

describe("openSlots", () => {
  it("removes slots that already hold a post, matched to the minute on the same channel", () => {
    const slots = slotsInRange(ch("UTC", [{ day: "mon", times: ["09:00", "12:00"] }]), START, END);
    const open = openSlots(slots, [
      { channelId: "c1", dueAt: "2026-11-02T09:00:00Z" },
      { channelId: "other", dueAt: "2026-11-02T12:00:00Z" },
      { channelId: "c1", dueAt: null },
    ]);
    expect(open.map((x) => x.at)).toEqual(["2026-11-02T12:00:00.000Z"]);
  });
});
