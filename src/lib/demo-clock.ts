/**
 * @fileoverview The demo's calendar. Alex's example is written for one week, Mon 2 to Sun 8 Nov 2026, with its story
 * around it (the newsletter on the Sunday before, Sam's note that evening, last week's deliveries). So the demo always
 * shows next week, every date in it moves by the same whole number of weeks: weekdays and the order of events stay as
 * written. The server works the shift out once per page and passes it down, so the browser never uses its own clock.
 */

/** The written week starts at midnight on Monday 2 Nov 2026 in Alex's time zone (Toronto, UTC-5 in November). */
export const DEMO_BASE_START = "2026-11-02T05:00:00Z";
/** Alex's time zone, which decides when "next week" begins. */
export const DEMO_TIME_ZONE = "America/Toronto";

const DAY = 86_400_000;

/** The calendar date (year, month, day) of an instant in Alex's time zone, as a UTC midnight timestamp. */
function localDate(at: Date): number {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: DEMO_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
  return Date.parse(`${parts}T00:00:00Z`);
}

/**
 * Days to add to every demo date so the written week is the week after `now` in Alex's time zone. Always a whole
 * number of weeks, and never negative: before the written week it stays as written.
 */
export function demoShiftDays(now: Date = new Date()): number {
  const today = localDate(now);
  const weekday = (new Date(today).getUTCDay() + 6) % 7; // 0 = Monday
  const nextMonday = today + (7 - weekday) * DAY;
  const base = localDate(new Date(DEMO_BASE_START));
  return Math.max(0, Math.round((nextMonday - base) / DAY));
}

/**
 * Days to move the example's past story (the newsletter on Sunday, Sam's note that evening, the drafts made from it,
 * last week's deliveries, the last approval) for a week moved by `shift`. The shown week is next week, but the story
 * must stay in the past: it moves to the latest Sunday before today and the week before it, one week behind the shown
 * week. Before the written week it stays as written.
 */
export function storyShift(shift: number): number {
  return shift === 0 ? 0 : shift - 7;
}

/** An ISO instant moved by `days`. */
export function shiftIso(iso: string, days: number): string {
  return new Date(Date.parse(iso) + days * DAY).toISOString();
}

/** "1 Nov": the day and month of an instant in Alex's time zone. */
export function dayMonth(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: DEMO_TIME_ZONE });
}

/** "Sun 1 Nov": the weekday, day and month of an instant in Alex's time zone. */
export function weekdayDayMonth(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: DEMO_TIME_ZONE }).replace(",", "");
}
