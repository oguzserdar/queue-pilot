import { describe, expect, it } from "vitest";
import type { OpenSlot } from "./open-slots";
import { fridayNudge } from "./friday-nudge";

const slot = (channel: string, at: string): OpenSlot => ({ id: `${channel}@${at}`, channelId: channel, channel, service: "x", organizationId: "o", at, local: at, timezone: "UTC" });
const friday = new Date("2026-10-30T15:00:00Z");

describe("fridayNudge", () => {
  it("is quiet when next week is full", () => {
    expect(fridayNudge([slot("X", "2026-10-31T09:00:00Z")], friday, "UTC")).toBeNull();
  });

  it("counts only next week's empty slots, busiest channel first", () => {
    const n = fridayNudge(
      [
        slot("LinkedIn", "2026-11-03T12:00:00Z"),
        slot("X", "2026-11-02T09:00:00Z"),
        slot("X", "2026-11-04T09:00:00Z"),
        slot("X", "2026-11-10T09:00:00Z"),
      ],
      friday,
      "UTC",
    );
    expect(n).toEqual({ subject: "3 empty slots in next week's Buffer queue", lines: ["X: 2 empty slots", "LinkedIn: 1 empty slot"], count: 3 });
  });

  it("uses the user's timezone for the week edge", () => {
    // Sunday 23:30 in New York is already Monday in UTC; for a New York user that slot is still this week.
    expect(fridayNudge([slot("X", "2026-11-02T04:30:00Z")], friday, "America/New_York")).toBeNull();
    expect(fridayNudge([slot("X", "2026-11-02T04:30:00Z")], friday, "UTC")?.count).toBe(1);
  });
});
