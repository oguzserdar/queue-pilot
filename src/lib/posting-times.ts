import "server-only";
import { isSocialNetwork } from "./social-networks";
/**
 * @fileoverview Posting times for accounts Queue Pilot posts to directly (Mastodon, Bluesky), so a person without
 * Buffer plans a week the same way: times per weekday in their own time zone. The accounts come back shaped like
 * Buffer channels, so the week grid and its slot maths are shared, not copied.
 */
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { socialAccount } from "@/db/schema";
import type { Channel, DayOfWeek } from "./buffer/queries";
import { DIRECT_PREFIX } from "./direct-channel";

const DAYS: readonly DayOfWeek[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
/** The most times one day may hold; a busy Buffer plan is a handful, and more is almost always a mistake. */
export const MAX_TIMES_PER_DAY = 12;

export type PostingTimes = { schedule: { day: DayOfWeek; paused: boolean; times: string[] }[]; timeZone: string };

const validZone = (tz: string) => { try { new Intl.DateTimeFormat("en", { timeZone: tz }); return true; } catch { return false; } };

/**
 * Checks a week of posting times as a person entered them.
 *
 * @param days - One entry per weekday, each with its "HH:MM" times (24-hour clock)
 * @param timeZone - IANA time zone the times are in
 * @returns The cleaned schedule (sorted, de-duplicated, empty days dropped), or the first problem in plain words
 */
export function parsePostingTimes(days: { day: string; times: string[] }[], timeZone: string): ({ ok: true } & PostingTimes) | { ok: false; message: string } {
  if (!validZone(timeZone)) return { ok: false, message: `"${timeZone}" is not a time zone Queue Pilot knows.` };
  const schedule: PostingTimes["schedule"] = [];
  for (const d of days) {
    const day = DAYS.find((x) => x === d.day);
    if (!day) return { ok: false, message: `"${d.day}" is not a day of the week.` };
    const bad = d.times.find((t) => !/^([01]\d|2[0-3]):[0-5]\d$/.test(t));
    if (bad !== undefined) return { ok: false, message: `"${bad}" is not a time. Use the 24-hour clock, like 09:00 or 17:30.` };
    const times = [...new Set(d.times)].sort();
    if (times.length > MAX_TIMES_PER_DAY) return { ok: false, message: `One day can hold at most ${MAX_TIMES_PER_DAY} times.` };
    if (times.length) schedule.push({ day, paused: false, times });
  }
  schedule.sort((a, b) => DAYS.indexOf(a.day) - DAYS.indexOf(b.day));
  return { ok: true, schedule, timeZone };
}

/**
 * Saves posting times on one of the person's own accounts.
 *
 * @param userId - The owner; an account of anyone else is never changed
 * @returns "not-found" when the account is not this person's
 */
export async function setPostingTimes(userId: string, accountId: string, times: PostingTimes): Promise<"ok" | "not-found"> {
  const rows = await db().update(socialAccount).set({ postingSchedule: times.schedule, timeZone: times.timeZone })
    .where(and(eq(socialAccount.id, accountId), eq(socialAccount.userId, userId))).returning({ id: socialAccount.id });
  return rows.length ? "ok" : "not-found";
}

/**
 * The person's direct accounts as week channels: id "direct:<account id>", its handle as the name, its network as
 * the service. An account with no time zone yet uses UTC and has no times, so it adds a row but no slots.
 *
 * @param userId - Whose accounts; nobody else's are ever returned
 */
export async function directChannels(userId: string): Promise<Channel[]> {
  const rows = await db().select({ id: socialAccount.id, network: socialAccount.network, handle: socialAccount.handle, brokenAt: socialAccount.brokenAt, postingSchedule: socialAccount.postingSchedule, timeZone: socialAccount.timeZone })
    .from(socialAccount).where(eq(socialAccount.userId, userId)).orderBy(socialAccount.connectedAt, socialAccount.id);
  return rows.flatMap((r) => (isSocialNetwork(r.network) ? [{
    id: `${DIRECT_PREFIX}${r.id}`, name: r.handle, service: r.network, timezone: r.timeZone ?? "UTC",
    isDisconnected: r.brokenAt !== null, isLocked: false, isQueuePaused: false, postingSchedule: r.postingSchedule,
  }] : []));
}
