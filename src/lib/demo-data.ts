/**
 * Example data shown to visitors who are not signed in. Fictional user: Mark Evans, who writes Weeknight Dinners, a weekly
 * cooking newsletter. Shapes mirror what the Buffer API returns: channels with posting slots, posts with status, dueAt
 * and an optional error. Drafts also carry, when Mark changed one, his edit.
 */

import type { WeekModel } from "./week-model";
import { channelCheck } from "./preflight";
import { countFor, limitFor, tooLong } from "./char-limits";

export type ChannelId = "linkedin" | "instagram" | "bluesky" | "x";

export type Channel = {
  id: ChannelId;
  name: string;
  /** Buffer's network name, as on a real channel. */
  service: string;
  handle: string;
  isDisconnected: boolean;
  isQueuePaused: boolean;
};

export type Source = {
  kind: "newsletter" | "blog" | "youtube" | "github";
  label: string;
  /** Where the material came from. Always the person's own work, never something an AI found elsewhere. */
  foundBy: string;
  detail: string;
};

export type Post = {
  id: string;
  channel: ChannelId;
  day: number; // 0 = Mon
  time: string;
  text: string;
  status: "scheduled" | "draft" | "sent" | "error";
  source?: Source;
  checks?: Check[];
  error?: { message: string; supportUrl: string };
  /** The draft as Queue Pilot wrote it, when the person has since changed it in Buffer or here. */
  editedFrom?: string;
  /** False for a draft the person wrote in Buffer: Queue Pilot never changes or deletes those. Example drafts are Queue Pilot's. */
  ours?: boolean;
};

export type Check = { tone: "success" | "warning" | "danger"; label: string };

export const WEEK_LABEL = "Mon 26 Oct – Sun 1 Nov 2026";
export const DAYS = ["Mon 26", "Tue 27", "Wed 28", "Thu 29", "Fri 30", "Sat 31", "Sun 1"];

export const channels: Channel[] = [
  { id: "linkedin", service: "linkedin", name: "LinkedIn", handle: "Mark Evans", isDisconnected: false, isQueuePaused: false },
  { id: "instagram", service: "instagram", name: "Instagram", handle: "@weeknightdinners", isDisconnected: false, isQueuePaused: false },
  { id: "bluesky", service: "bluesky", name: "Bluesky", handle: "weeknightdinners.bsky.social", isDisconnected: true, isQueuePaused: false },
  { id: "x", service: "twitter", name: "X", handle: "@weeknightdinners", isDisconnected: false, isQueuePaused: false },
];

/** Posting slots from each channel's postingSchedule, as day index → times. */
export const slots: Record<ChannelId, Record<number, string[]>> = {
  linkedin: { 1: ["12:00"], 3: ["15:00"], 4: ["12:00"] },
  instagram: { 1: ["18:00"], 4: ["10:00"] },
  bluesky: { 2: ["9:00"] },
  x: { 0: ["9:00"], 3: ["9:00"] },
};

const issue41: Source = { kind: "newsletter", label: "Weeknight Dinners 41: white bean and kale soup", foundBy: "Your newsletter", detail: "Sent Sun 25 Oct, not posted yet" };
const issue39: Source = { kind: "newsletter", label: "Weeknight Dinners 39: three pantry swaps", foundBy: "Your newsletter", detail: "Sent Sun 11 Oct, posted once on LinkedIn" };


const draftsAndPosts: Post[] = [
  { id: "p1", channel: "x", day: 0, time: "9:00", status: "scheduled", text: "Soup season. Issue 40 was all about stock." },
  { id: "p2", channel: "instagram", day: 4, time: "10:00", status: "scheduled", text: "Sunday bake, part two." },
  {
    id: "d1", channel: "linkedin", day: 1, time: "12:00", status: "draft", source: issue41,
    text: "White bean and kale soup, and the trick for crisp sourdough croutons. Weeknight Dinners 41.",
  },
  {
    id: "d2", channel: "instagram", day: 1, time: "18:00", status: "draft", source: issue41,
    editedFrom: "The soup I make on repeat when it turns cold. Recipe in the newsletter, link in bio.",
    text: "My cold-night soup. Recipe in the newsletter, link in bio.",
  },
  {
    id: "d3", channel: "bluesky", day: 2, time: "9:00", status: "draft", source: issue41,
    text: "White beans, kale, stale bread made useful. Weeknight Dinners 41 is out.",
  },
  {
    id: "d4", channel: "x", day: 3, time: "9:00", status: "draft", source: issue41,
    text: "Stale sourdough makes the crispest croutons, in ten minutes. The trick is in Weeknight Dinners 41.",
  },
  {
    id: "d5", channel: "linkedin", day: 3, time: "15:00", status: "draft", source: issue39,
    text: "Three pantry swaps that save a weeknight: miso for stock, chickpeas for cream, lemon for salt. From Weeknight Dinners 39.",
  },
];

/**
 * Each example draft's "Before it goes out" checks, made by the same functions that check real drafts (preflight.ts
 * channelCheck, char-limits.ts), so the example shows only checks Queue Pilot runs.
 */
function realChecks(p: Post): Post {
  if (p.status !== "draft") return p;
  const ch = channels.find((c) => c.id === p.channel);
  const service = ch?.service ?? p.channel;
  const out: NonNullable<Post["checks"]> = [];
  if (ch) {
    const c = channelCheck({ ...ch, isLocked: false });
    out.push(c.result === "pass" ? { tone: "success", label: c.detail } : { tone: "danger", label: c.detail });
  }
  const limit = limitFor(service);
  const long = tooLong(service, p.text);
  if (limit) out.push(long ? { tone: "danger", label: long } : { tone: "success", label: `Fits ${ch?.name ?? p.channel} (${countFor(service, p.text)} of ${limit.toLocaleString("en-GB")} characters)` });
  return { ...p, checks: out };
}

export const posts: Post[] = draftsAndPosts.map(realChecks);

/** Delivery watch: past slots and what happened, using the post error Buffer reports. */
export const deliveries = [
  { id: "w1", at: "2026-10-12T12:00:00Z", channel: "LinkedIn", title: "Posted: \"Three pantry swaps that save a weeknight\"", tone: "success" as const },
  { id: "w2", at: "2026-10-13T18:00:00Z", channel: "Instagram", title: "Posted: \"Stock from scraps\"", tone: "success" as const },
  {
    id: "w3", at: "2026-10-14T09:00:00Z", channel: "X", title: "Failed: \"Issue 39 is out\"", tone: "danger" as const,
    error: { message: "The image could not be loaded from its link when it was time to post.", supportUrl: "https://support.buffer.com" },
  },
  { id: "w4", at: "2026-10-15T12:00:00Z", channel: "LinkedIn", title: "Posted: \"Why I stopped buying stock\"", tone: "success" as const },
];


/** The example week shown to visitors who are not signed in. */
export const demoWeek: WeekModel = { label: WEEK_LABEL, days: DAYS, channels, slots, posts };

/** Example copy marks for the Delivery screen: the two sent posts also went to Telegram and Discord. */
export const deliveryCopies = {
  w1: [{ kind: "telegram" as const, ok: true }, { kind: "discord" as const, ok: true }],
  w2: [{ kind: "telegram" as const, ok: true }],
};
