/**
 * What the Next week screen draws: seven day columns, one row per channel with its posting slots, and the posts in them.
 * Built from example data when signed out and from the user's Buffer account when signed in.
 */
import type { Post } from "./demo-data";

/** service is Buffer's network name (linkedin, instagram, twitter...), which playbook rules are scoped by. */
/** timezone is the channel's own IANA zone in Buffer: its slots post at these local times. */
export type WeekChannel = { id: string; name: string; service?: string; isDisconnected: boolean; isQueuePaused: boolean; timezone?: string };
export type WeekPost = Omit<Post, "channel"> & { channel: string };

export type WeekModel = {
  /** e.g. "Mon 2 Nov – Sun 8 Nov 2026" */
  label: string;
  /** Seven column labels, Monday first, e.g. "Mon 2". */
  days: string[];
  channels: WeekChannel[];
  /** channel id → day index (0 = Monday) → slot times "H:MM" in the channel's timezone. */
  slots: Record<string, Record<number, string[]>>;
  posts: WeekPost[];
  /** The zone the day columns are drawn in (IANA). */
  timeZone?: string;
  /** When the week starts (ISO), so zone offsets are read for this week, across daylight-saving changes. */
  startsAt?: string;
  /** "channel-day-time" → the slot id Queue Pilot saves into (open-slots.ts), for writing one post into one empty slot. */
  slotIds?: Record<string, string>;
};

/** The key of a slot in WeekModel.slotIds. */
export const slotKey = (channelId: string, day: number, time: string) => `${channelId}-${day}-${time}`;

/** Slots open to fill: no post, or only a failed one (as open-slots.ts and "Write my week" count them). */
export function countOpenSlots(week: WeekModel): number {
  const taken = new Set(week.posts.filter((p) => p.status !== "error").map((p) => `${p.channel}-${p.day}-${p.time}`));
  let open = 0;
  for (const ch of week.channels) for (const [day, times] of Object.entries(week.slots[ch.id] ?? {})) for (const t of times) if (!taken.has(`${ch.id}-${day}-${t}`)) open++;
  return open;
}

/** Minutes after midnight for "H:MM", so 9:00 sorts before 10:00. */
const minutes = (t: string) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };

/**
 * What one channel's day cell shows, in time order: every posting slot (with its posts, or none) and every post at a
 * time that is not a slot. Two posts at one time are both shown.
 */
export function cellEntries(week: WeekModel, channelId: string, day: number): { time: string; slot: boolean; posts: WeekPost[] }[] {
  const slotTimes = new Set(week.slots[channelId]?.[day] ?? []);
  const posts = week.posts.filter((p) => p.channel === channelId && p.day === day);
  const times = new Set([...slotTimes, ...posts.map((p) => p.time)]);
  return [...times]
    .sort((a, b) => minutes(a) - minutes(b))
    .map((time) => ({ time, slot: slotTimes.has(time), posts: posts.filter((p) => p.time === time) }));
}

/** The earliest empty slot of the week on a channel Buffer can post to, for "new post"; null when every slot is taken. */
export function firstEmptySlot(week: WeekModel): { channelId: string; day: number; time: string } | null {
  let best: { channelId: string; day: number; time: string } | null = null;
  for (const ch of week.channels) {
    if (ch.isDisconnected) continue;
    for (let day = 0; day < 7; day++)
      for (const e of cellEntries(week, ch.id, day))
        if (e.slot && !e.posts.length && (!best || day < best.day || (day === best.day && minutes(e.time) < minutes(best.time)))) best = { channelId: ch.id, day, time: e.time };
  }
  return best;
}

/**
 * A zone as people read it: its city and its offset on that date, e.g. "New York, GMT-5". The offset comes from the
 * date, so it follows daylight saving.
 */
export function zoneLabel(timeZone: string, at: Date): string {
  const city = (timeZone.split("/").pop() ?? timeZone).replaceAll("_", " ");
  const offset = new Intl.DateTimeFormat("en-GB", { timeZone, timeZoneName: "shortOffset" }).formatToParts(at).find((p) => p.type === "timeZoneName")?.value ?? "";
  return offset ? `${city}, ${offset === "GMT" ? "GMT+0" : offset}` : city;
}


/** The worst check on a post decides its tone: one failing check makes it "danger". */
export function worstTone(p: { checks?: { tone: string }[] }): "danger" | "warning" | "success" {
  if (p.checks?.some((c) => c.tone === "danger")) return "danger";
  if (p.checks?.some((c) => c.tone === "warning")) return "warning";
  return "success";
}

/** How each tone reads on a post. */
export const TONE_LABEL = { success: "Ready", warning: "Check", danger: "Will fail" } as const;
