/**
 * @fileoverview The demo always shows next week: the shift is whole weeks, starts on Monday in Alex's time zone, and
 * never moves the written week backwards.
 */
import { describe, expect, it } from "vitest";
import { dayMonth, demoShiftDays, shiftIso, weekdayDayMonth } from "./demo-clock";
import { demoDeliveries, demoPosts, demoWeekFor } from "./demo-data";
import { exampleTeamNote } from "./example-notes";
import { exampleApprovalsFor, exampleEvidenceFor, exampleNotes } from "./example-week-extras";

describe("demoShiftDays", () => {
  it("keeps the written week before and during the week before it", () => {
    expect(demoShiftDays(new Date("2026-10-20T12:00:00Z"))).toBe(0);
    expect(demoShiftDays(new Date("2026-10-31T12:00:00Z"))).toBe(0);
  });

  it("moves to the week after today, in whole weeks", () => {
    expect(demoShiftDays(new Date("2026-11-09T15:00:00Z"))).toBe(14); // Mon 9 Nov: next week is 16 to 22 Nov
    expect(demoShiftDays(new Date("2026-11-18T15:00:00Z"))).toBe(21); // judging week: next week is 23 to 29 Nov
    expect(demoShiftDays(new Date("2027-03-03T15:00:00Z")) % 7).toBe(0);
  });

  it("turns over at midnight in Toronto, not in UTC", () => {
    // 03:00 UTC on Mon 16 Nov is still Sunday 15 Nov, 22:00, in Toronto.
    expect(demoShiftDays(new Date("2026-11-16T03:00:00Z"))).toBe(14);
    expect(demoShiftDays(new Date("2026-11-16T06:00:00Z"))).toBe(21);
  });
});

describe("dates", () => {
  it("move and read in Alex's time zone", () => {
    expect(shiftIso("2026-11-01T21:05:00Z", 14)).toBe("2026-11-15T21:05:00.000Z");
    expect(dayMonth("2026-11-01T21:05:00Z")).toBe("1 Nov");
    expect(weekdayDayMonth("2026-11-01T21:05:00Z")).toBe("Sun 1 Nov");
  });
});

describe("the example story", () => {
  it("is always in the past while the shown week is always next week, at hours across a year", () => {
    for (let day = 0; day < 400; day++) {
      // From the day this went live: the written week itself (shift 0) is already in the past.
      const now = new Date(Date.parse("2026-11-09T00:00:00Z") + day * 3_600_000 * 23);
      const shift = demoShiftDays(now);
      const past = [
        ...demoDeliveries(shift).map((d) => d.at),
        ...demoPosts(shift).flatMap((p) => (p.createdAt ? [p.createdAt] : [])),
        exampleTeamNote(shift).at!,
        ...exampleEvidenceFor(shift).map((c) => c.lastCheckedAt!),
        ...Object.values(exampleNotes(["d1"], shift)).flatMap((n) => n.notes.flatMap((x) => (x.createdAt ? [x.createdAt] : []))),
      ];
      for (const at of past) expect(Date.parse(at), `${at} on ${now.toISOString()}`).toBeLessThanOrEqual(now.getTime());
      const start = Date.parse(demoWeekFor(shift).startsAt ?? "");
      if (shift > 0) expect(start).toBeGreaterThan(now.getTime());
      expect(start - now.getTime()).toBeLessThanOrEqual(8 * 86_400_000);
    }
  });

  it("dates the newsletter and the last approval on a past Sunday", () => {
    const shift = demoShiftDays(new Date("2026-11-09T15:00:00Z"));
    expect(demoPosts(shift).find((p) => p.id === "d1")!.source!.detail).toBe("Sent Sun 8 Nov, not posted yet");
    expect(exampleApprovalsFor(shift).p1).toContain("8 Nov");
  });
});
