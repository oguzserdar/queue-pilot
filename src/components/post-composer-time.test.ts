/**
 * @fileoverview Picking a send time across clock changes, in a zone with daylight saving (America/New_York, 2027): a
 * time the clocks skip is refused instead of moved, a time that happens twice shows its offset, and "tomorrow" is the
 * next calendar day even when a day has 25 hours.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let before: string | undefined;
beforeAll(() => { before = process.env.TZ; process.env.TZ = "America/New_York"; });
afterAll(() => { process.env.TZ = before; });

const load = () => import("./post-composer");

describe("send times across clock changes", () => {
  it("refuses a time the clocks skip", async () => {
    const { atLocal } = await load();
    expect(atLocal(new Date(2027, 2, 14), "02:30")).toBeNull();
    expect(atLocal(new Date(2027, 2, 14), "03:30")?.toISOString()).toBe("2027-03-14T07:30:00.000Z");
  });

  it("shows the offset for a time that happens twice, and none on an ordinary day", async () => {
    const { atLocal, repeatedOffset } = await load();
    expect(repeatedOffset(atLocal(new Date(2027, 10, 7), "01:30")!)).toMatch(/^UTC−[45]$/);
    expect(repeatedOffset(atLocal(new Date(2027, 10, 8), "01:30")!)).toBeNull();
  });

  it("takes tomorrow as the next calendar day on a 25-hour day", async () => {
    const { daysFrom } = await load();
    const late = new Date(2027, 10, 7, 23, 30);
    expect(daysFrom(late, 1).getDate()).toBe(8);
    expect(new Date(late.getTime() + 86_400_000).getDate()).toBe(8);
    const early = new Date(2027, 10, 7, 0, 30);
    expect(daysFrom(early, 1).getDate()).toBe(8);
    expect(new Date(early.getTime() + 86_400_000).getDate()).toBe(7); // why adding 24 hours was wrong
  });
});
