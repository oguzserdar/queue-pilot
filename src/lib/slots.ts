/**
 * Open posting slots: the channel's weekly posting times (Buffer ScheduleV2, "HH:MM" in the channel's own timezone)
 * expanded over a date range, minus the slots that already hold a post. All instants are returned in UTC ISO form.
 */
import type { Channel, DayOfWeek, Post } from "./buffer/queries";

const DAYS: DayOfWeek[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

/** The local calendar date and weekday of a UTC instant in a timezone. */
function localDate(instant: Date, timeZone: string): { y: number; m: number; d: number; day: DayOfWeek } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short" })
      .formatToParts(instant)
      .map((p) => [p.type, p.value]),
  );
  return { y: Number(parts.year), m: Number(parts.month), d: Number(parts.day), day: parts.weekday.toLowerCase().slice(0, 3) as DayOfWeek };
}

/** Offset of a timezone from UTC, in minutes, at a given instant. */
function offsetMinutes(instant: Date, timeZone: string): number {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      .formatToParts(instant)
      .map((x) => [x.type, x.value]),
  );
  const asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
  return Math.round((asUtc - instant.getTime()) / 60_000);
}

/** The UTC instant for a wall-clock time in a timezone. Checks the offset twice so days that change clocks land right. */
export function zonedToUtc(y: number, m: number, d: number, hh: number, mm: number, timeZone: string): Date {
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const first = guess - offsetMinutes(new Date(guess), timeZone) * 60_000;
  return new Date(guess - offsetMinutes(new Date(first), timeZone) * 60_000);
}

export type Slot = { channelId: string; at: string; day: DayOfWeek; time: string };

/** Every scheduled slot for a channel whose instant falls in [start, end). Paused days and a paused queue give none. */
export function slotsInRange(channel: Pick<Channel, "id" | "timezone" | "isQueuePaused" | "postingSchedule">, start: Date, end: Date): Slot[] {
  if (channel.isQueuePaused) return [];
  const byDay = new Map(channel.postingSchedule.filter((s) => !s.paused).map((s) => [s.day, s.times]));
  const out: Slot[] = [];
  const seen = new Set<string>();
  // Walk local calendar days, starting a day early so slots near midnight in far timezones are not missed.
  for (let t = start.getTime() - 86_400_000; t < end.getTime() + 86_400_000; t += 86_400_000) {
    const { y, m, d, day } = localDate(new Date(t), channel.timezone);
    const key = `${y}-${m}-${d}`;
    if (seen.has(key)) continue;
    seen.add(key);
    for (const time of byDay.get(day) ?? []) {
      const [hh, mm] = time.split(":").map(Number);
      const at = zonedToUtc(y, m, d, hh, mm, channel.timezone);
      if (at >= start && at < end) out.push({ channelId: channel.id, at: at.toISOString(), day, time });
    }
  }
  return out.sort((a, b) => a.at.localeCompare(b.at));
}

/** Slots with no post already due on that channel at that minute. Sent, failed and draft posts with a time all count as taken. */
export function openSlots(slots: Slot[], posts: Pick<Post, "channelId" | "dueAt">[]): Slot[] {
  const taken = new Set(posts.filter((p) => p.dueAt).map((p) => `${p.channelId}@${new Date(p.dueAt!).toISOString().slice(0, 16)}`));
  return slots.filter((s) => !taken.has(`${s.channelId}@${s.at.slice(0, 16)}`));
}

export { DAYS };
