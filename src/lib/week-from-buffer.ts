/**
 * Builds the Next week screen's model from a Buffer account: the coming Monday to Sunday in a reference timezone,
 * each channel's posting slots placed on their local day and time, and the account's posts placed into those slots.
 */
import type { Channel, DayOfWeek, Post as BufferPost } from "./buffer/queries";
import { slotsInRange, zonedToUtc } from "./slots";
import { slotId } from "./open-slots";
import { slotKey, type WeekModel, type WeekPost } from "./week-model";

const INDEX: Record<DayOfWeek, number> = { mon: 0, tue: 1, wed: 2, thu: 3, fri: 4, sat: 5, sun: 6 };

function parts(instant: Date, timeZone: string) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(instant)
      .map((x) => [x.type, x.value]),
  );
  return { weekday: p.weekday as string, day: Number(p.day), month: p.month as string, year: Number(p.year), time: `${Number(p.hour)}:${p.minute}` };
}

/** The next Monday 00:00 (always the following week, even on a Monday) to the Monday after, in a timezone. */
export function nextWeekRange(now: Date, timeZone: string): { start: Date; end: Date } {
  const today = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short" }).formatToParts(now);
  const get = (t: string) => today.find((x) => x.type === t)!.value;
  const dow = INDEX[get("weekday").toLowerCase().slice(0, 3) as DayOfWeek];
  const base = Date.UTC(Number(get("year")), Number(get("month")) - 1, Number(get("day")));
  const monday = new Date(base + (7 - dow) * 86_400_000);
  const start = zonedToUtc(monday.getUTCFullYear(), monday.getUTCMonth() + 1, monday.getUTCDate(), 0, 0, timeZone);
  const nextMonday = new Date(monday.getTime() + 7 * 86_400_000);
  const end = zonedToUtc(nextMonday.getUTCFullYear(), nextMonday.getUTCMonth() + 1, nextMonday.getUTCDate(), 0, 0, timeZone);
  return { start, end };
}

const STATUS: Record<BufferPost["status"], WeekPost["status"]> = {
  draft: "draft",
  needs_approval: "scheduled",
  scheduled: "scheduled",
  sending: "scheduled",
  sent: "sent",
  error: "error",
};

/** The week model for a signed-in account. Posts outside the week or on unknown channels are left out. */
export function weekFromBuffer(channels: Channel[], posts: BufferPost[], range: { start: Date; end: Date }, timeZone: string): WeekModel {
  const days = Array.from({ length: 7 }, (_, i) => {
    const p = parts(new Date(range.start.getTime() + i * 86_400_000 + 12 * 3_600_000), timeZone);
    return `${p.weekday} ${p.day}`;
  });
  const first = parts(range.start, timeZone);
  const last = parts(new Date(range.end.getTime() - 1), timeZone);
  const label = `${first.weekday} ${first.day} ${first.month} – ${last.weekday} ${last.day} ${last.month} ${last.year}`;

  const slots: WeekModel["slots"] = {};
  const slotIds: Record<string, string> = {};
  for (const ch of channels) {
    const byDay: Record<number, string[]> = {};
    for (const s of slotsInRange(ch, range.start, range.end)) {
      const local = parts(new Date(s.at), ch.timezone);
      (byDay[INDEX[s.day]] ??= []).push(local.time);
      slotIds[slotKey(ch.id, INDEX[s.day], local.time)] = slotId(ch.id, new Date(s.at).toISOString());
    }
    slots[ch.id] = byDay;
  }

  const byId = new Map(channels.map((c) => [c.id, c]));
  const weekPosts: WeekPost[] = [];
  for (const p of posts) {
    const ch = byId.get(p.channelId);
    if (!ch || !p.dueAt) continue;
    const at = new Date(p.dueAt);
    if (at < range.start || at >= range.end) continue;
    const local = parts(at, ch.timezone);
    const day = INDEX[local.weekday.toLowerCase().slice(0, 3) as DayOfWeek];
    weekPosts.push({
      id: p.id,
      channel: ch.id,
      day,
      time: local.time,
      text: p.text,
      status: STATUS[p.status],
      ours: p.via === "api",
      ...(p.error ? { error: { message: p.error.message, supportUrl: p.error.supportUrl ?? "" } } : {}),
    });
  }

  return {
    label,
    days,
    channels: channels.map((c) => ({ id: c.id, name: c.name, service: c.service, isDisconnected: c.isDisconnected, isQueuePaused: c.isQueuePaused, timezone: c.timezone })),
    slots,
    posts: weekPosts,
    timeZone,
    startsAt: range.start.toISOString(),
    slotIds,
  };
}
