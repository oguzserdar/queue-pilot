/**
 * The Friday nudge: on Friday, if next week (Monday to Sunday) still has empty slots, tell the user how many and where,
 * with one link to fill them. Buffer's own notice only arrives once the queue is already empty; this one arrives while
 * there is still time. Pure: the caller decides how it is sent.
 */
import type { OpenSlot } from "./open-slots";
import { nextWeekRange } from "./week-from-buffer";

export type Nudge = { subject: string; lines: string[]; count: number };

/**
 * The nudge for next week's empty slots, or null when nothing is empty. Uses the same week as the home screen (nextWeekRange, in the user's timezone), so the two
 * never disagree.
 */
export function fridayNudge(slots: OpenSlot[], now: Date, timeZone: string): Nudge | null {
  const { start, end } = nextWeekRange(now, timeZone);
  const empty = slots.filter((s) => {
    const t = Date.parse(s.at);
    return t >= start.getTime() && t < end.getTime();
  });
  if (empty.length === 0) return null;
  const byChannel = new Map<string, number>();
  for (const s of empty) byChannel.set(s.channel, (byChannel.get(s.channel) ?? 0) + 1);
  const lines = [...byChannel.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([channel, n]) => `${channel}: ${n} empty slot${n === 1 ? "" : "s"}`);
  return {
    subject: `${empty.length} empty slot${empty.length === 1 ? "" : "s"} in next week's Buffer queue`,
    lines,
    count: empty.length,
  };
}
