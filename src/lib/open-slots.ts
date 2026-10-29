/**
 * The empty posting slots in a date range, worked out once on the server so the user's AI does not have to combine
 * posting schedules, timezones and existing posts itself (many Buffer calls, easy to get wrong).
 */
import type { Channel, Post } from "./buffer/queries";
import { slotsInRange } from "./slots";

export type OpenSlot = {
  /** Stable id the AI passes back to save a draft: "<channelId>@<ISO time>". */
  id: string;
  channelId: string;
  channel: string;
  service: string;
  organizationId: string | null;
  /** UTC instant of the slot. */
  at: string;
  /** The slot in the channel's own timezone, e.g. "Tue 27 Oct 09:00". */
  local: string;
  /** That timezone, as Buffer names it (IANA, e.g. "America/New_York"). */
  timezone: string;
};

export type SkippedChannel = { channel: string; reason: string };

/** Posts in these states hold their slot; a failed post leaves the slot open to refill. */
const HOLDS_SLOT = new Set<Post["status"]>(["draft", "needs_approval", "scheduled", "sending", "sent"]);

/** Two times count as the same slot when they are within a minute of each other. */
const SAME_SLOT_MS = 60_000;

export const slotId = (channelId: string, at: string) => `${channelId}@${at}`;

/** Splits a slot id back into its channel and time; null when the id is not one of ours. */
export function parseSlotId(id: string): { channelId: string; at: string } | null {
  const i = id.lastIndexOf("@");
  if (i <= 0) return null;
  const at = id.slice(i + 1);
  if (Number.isNaN(Date.parse(at))) return null;
  return { channelId: id.slice(0, i), at };
}

function localLabel(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .format(at)
    .replace(",", "");
}

/**
 * Every empty slot between start and end, oldest first. Channels Buffer cannot post to right now (disconnected,
 * locked, queue paused) are listed as skipped with the reason, so the AI can tell the user instead of drafting for them.
 */
export function openSlots(channels: Channel[], posts: Post[], range: { start: Date; end: Date }): { slots: OpenSlot[]; skipped: SkippedChannel[] } {
  const slots: OpenSlot[] = [];
  const skipped: SkippedChannel[] = [];
  for (const ch of channels) {
    const reason = ch.isDisconnected ? "disconnected in Buffer" : ch.isLocked ? "locked in Buffer" : ch.isQueuePaused ? "queue paused in Buffer" : null;
    if (reason) {
      skipped.push({ channel: ch.name, reason });
      continue;
    }
    const taken = posts
      .filter((p) => p.channelId === ch.id && p.dueAt && HOLDS_SLOT.has(p.status))
      .map((p) => Date.parse(p.dueAt as string));
    for (const s of slotsInRange(ch, range.start, range.end)) {
      const at = new Date(s.at);
      if (taken.some((t) => Math.abs(t - at.getTime()) < SAME_SLOT_MS)) continue;
      const iso = at.toISOString();
      slots.push({ id: slotId(ch.id, iso), channelId: ch.id, channel: ch.name, service: ch.service, organizationId: ch.organizationId ?? null, at: iso, local: localLabel(at, ch.timezone), timezone: ch.timezone });
    }
  }
  slots.sort((a, b) => a.at.localeCompare(b.at) || a.channel.localeCompare(b.channel));
  return { slots, skipped };
}

/**
 * The stretch of the next 14 days the saved copy can vouch for. It ends early when the copy was read a while ago (its
 * range ends sooner) or when Buffer had more posts than one read takes (posts come oldest first, so nothing after the
 * last one read is known). `note` says why, for the AI to pass on.
 */
export function knownRange(
  data: { posts: { dueAt: string | null }[]; truncated?: boolean; range?: { end: string } },
  now: Date,
): { start: Date; end: Date; note: string | null } {
  const want = now.getTime() + 14 * 86_400_000;
  let end = want;
  let note: string | null = null;
  if (data.range?.end) end = Math.min(end, Date.parse(data.range.end));
  if (data.truncated) {
    const last = Math.max(...data.posts.map((p) => (p.dueAt ? Date.parse(p.dueAt) : 0)), 0);
    if (last && last < end) {
      end = last;
      note = `Your Buffer queue has more posts than one read covers, so slots after ${new Date(last).toISOString().slice(0, 16).replace("T", " ")} UTC are not listed. Check those in Buffer.`;
    }
  }
  return { start: now, end: new Date(Math.max(end, now.getTime())), note };
}
