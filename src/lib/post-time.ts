/**
 * @fileoverview Times and result words for direct posts, as people read them: a time in their own time zone, a day and
 * "HH:MM" made into one moment, the clock-change edge cases, a handle's short name, and what happened to a sent post.
 */

/** The name part of a handle for a tab: "@ada@mastodon.social" reads "@ada", "ada.bsky.social" reads "ada". */
export const shortHandle = (handle: string) => (handle.startsWith("@") ? `@${handle.slice(1).split("@")[0]}` : handle.split(".")[0]);

/** A time as people read it, in their own time zone: "Sun 9 Nov, 18:00". */
export function when(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

/**
 * The local date plus "HH:MM", as one moment in the browser's time zone. Returns null for a time that does not
 * exist that day (the clocks jump forward over it), rather than quietly moving it an hour.
 */
export function atLocal(day: Date, hhmm: string): Date | null {
  const [h, m] = hhmm.split(":").map(Number);
  const d = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m, 0, 0);
  return d.getHours() === h && d.getMinutes() === m && d.getDate() === day.getDate() ? d : null;
}

/** The same calendar day n days on, whatever the length of the days between (23 or 25 hours on clock changes). */
export function daysFrom(base: Date, n: number): Date {
  return new Date(base.getFullYear(), base.getMonth(), base.getDate() + n);
}

/**
 * The UTC offset to show beside a time that happens twice that day (the clocks go back over it), e.g. "UTC−5";
 * null when the time happens once.
 */
export function repeatedOffset(at: Date): string | null {
  const same = (t: Date) => t.getHours() === at.getHours() && t.getMinutes() === at.getMinutes();
  if (!same(new Date(at.getTime() + 3_600_000)) && !same(new Date(at.getTime() - 3_600_000))) return null;
  const off = -at.getTimezoneOffset();
  const hh = Math.floor(Math.abs(off) / 60), mm = Math.abs(off) % 60;
  return `UTC${off < 0 ? "−" : "+"}${hh}${mm ? `:${String(mm).padStart(2, "0")}` : ""}`;
}

/** How one result reads: landed with a link, refused with Telegram's or Discord's reason, or may have landed. */
export function resultWords(r: { status: string; error: string | null; sendAt?: string | null; late?: boolean }): string {
  if (r.status === "scheduled") return r.sendAt ? `Scheduled for ${when(r.sendAt)}` : "Scheduled";
  if (r.status === "cancelled") return "Cancelled";
  if (r.status === "sent") return r.late && r.sendAt ? `Sent late (it was due ${when(r.sendAt)})` : "Sent";
  if (r.status === "failed") return `Not sent: ${r.error ?? "refused"}`;
  if (r.status === "pending") return "Sending";
  return "No answer in time, so it may have been sent. Check the channel before sending it again.";
}
