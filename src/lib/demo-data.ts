/**
 * Example data shown to visitors who are not signed in. Fictional user: Alex Rivera, who writes This Week in AI, a Sunday
 * newsletter on AI model releases and agents. Shapes mirror what the Buffer API returns: channels with posting slots, posts with status, dueAt
 * and an optional error. Drafts also carry, when Alex changed one, the edit.
 */

import { channels, type Channel, type ChannelId } from "./example-channels";
export { channels, type Channel, type ChannelId } from "./example-channels";

import type { WeekModel } from "./week-model";
import { channelCheck } from "./preflight";
import { countFor, limitFor, tooLong } from "./char-limits";
import { DEMO_BASE_START, shiftIso, storyShift, weekdayDayMonth } from "./demo-clock";

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
  /** When Buffer says the post was created, and the name of who created it, when Buffer gives them. */
  createdAt?: string;
  createdBy?: string | null;
};

export type Check = { tone: "success" | "warning" | "danger"; label: string };

/** The shown week's day names ("Mon 16"), Monday first, moved by `shift` days (see demo-clock.ts). */
export function demoDays(shift: number): string[] {
  return Array.from({ length: 7 }, (_, i) => weekdayDayMonth(shiftIso(DEMO_BASE_START, shift + i)).replace(/ [A-Z][a-z]{2}$/, ""));
}

/** "Mon 16 Nov – Sun 22 Nov 2026": the shown week, moved by `shift` days. */
export function demoWeekLabel(shift: number): string {
  const sunday = shiftIso(DEMO_BASE_START, shift + 6);
  return `${weekdayDayMonth(shiftIso(DEMO_BASE_START, shift))} – ${weekdayDayMonth(sunday)} ${new Date(sunday).getUTCFullYear()}`;
}


/** Posting slots from each channel's postingSchedule, as day index → times. */
export const slots: Record<ChannelId, Record<number, string[]>> = {
  linkedin: { 1: ["12:00"], 3: ["15:00"], 4: ["12:00"] },
  instagram: { 1: ["18:00"], 4: ["10:00"] },
  threads: { 2: ["9:00"] },
  x: { 0: ["9:00"], 3: ["9:00"] },
};

// The news in these issues is real (Oct 2026); each draft's claims are quoted from the primary source in
// example-week-extras.ts.
// Issue 41 went out on the latest Sunday before today, issue 40 the Sunday before that (storyShift in demo-clock.ts).
const issue41 = (shift: number): Source => ({ kind: "newsletter", label: "This Week in AI 41: Terra, Carbon, and 40 agents in Android Studio", foundBy: "Your newsletter", detail: `Sent ${weekdayDayMonth(shiftIso(DEMO_BASE_START, storyShift(shift) - 1))}, not posted yet` });
const issue40 = (shift: number): Source => ({ kind: "newsletter", label: "This Week in AI 40: Claude Duet, Kimi K3.1 Pro, DeepSeek 1017", foundBy: "Your newsletter", detail: `Sent ${weekdayDayMonth(shiftIso(DEMO_BASE_START, storyShift(shift) - 8))}, posted three times` });


const draftsAndPosts = (shift: number): Post[] => [
  { id: "p1", channel: "x", day: 0, time: "9:00", status: "scheduled", text: "Issue 41 is out: GPT-6.1 Terra, Gemini 4 Carbon, and coding agents in Android Studio." },
  { id: "p2", channel: "instagram", day: 4, time: "10:00", status: "scheduled", text: "Friday reading, part two." },
  {
    id: "d1", channel: "linkedin", day: 1, time: "12:00", status: "draft", source: issue41(shift),
    text: "Gemini 4 Carbon ranks #1 on the Artificial Analysis Intelligence Index, at 59. For now only a subset of cyber defenders can use it. I want to see it on real repos before I switch. More in This Week in AI 41.",
  },
  {
    id: "d2", channel: "instagram", day: 1, time: "18:00", status: "draft", source: issue41(shift),
    editedFrom: "This week felt like a turning point for coding agents. Full notes in the newsletter, link in bio.",
    text: "Android Studio now lets you pick from over 40 coding agents. Full notes in the newsletter, link in bio.",
  },
  {
    id: "d3", channel: "threads", day: 2, time: "9:00", status: "draft", source: issue41(shift),
    text: "GPT-6.1 Terra, Gemini 4 Carbon, and over 40 coding agents in Android Studio. This Week in AI 41 is out.",
  },
  {
    id: "d4", channel: "x", day: 3, time: "9:00", status: "draft", source: issue41(shift),
    text: "GPT-6.1 Terra is OpenAI's new fast model for high-volume work and computer use. Does it hold up on a long agent run? That is my test for issue 42.",
  },
  {
    id: "d5", channel: "linkedin", day: 3, time: "15:00", status: "draft", source: issue40(shift),
    text: "Claude Duet keeps working when you step away and checks with you before it acts. It is a research preview, in the Pro, Max and Ultra plans. From This Week in AI 40.",
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

// Buffer reports when and by whom each post was created; the live draft window shows it, so the example does too.
const CREATED: Record<string, string> = { d1: "2026-11-01T18:20:00Z", d2: "2026-11-01T18:20:00Z", d3: "2026-11-01T18:21:00Z", d4: "2026-11-01T18:21:00Z", d5: "2026-10-30T09:05:00Z" };

/** The example's posts, every date moved by `shift` days. */
export function demoPosts(shift: number): Post[] {
  return draftsAndPosts(shift).map(realChecks).map((p) => (CREATED[p.id] ? { ...p, createdAt: shiftIso(CREATED[p.id], storyShift(shift)), createdBy: "Alex Rivera" } : p));
}

/** One example post's text. Text never depends on the date. */
export const postText = (id: string): string => draftsAndPosts(0).find((p) => p.id === id)!.text;

/** Delivery watch: past slots and what happened, using the post error Buffer reports. */
const DELIVERIES = [
  { id: "w1", at: "2026-10-26T12:00:00Z", channel: "LinkedIn", title: "Posted: \"DeepSeek's 1017 update: shorter outputs, faster tasks\"", tone: "success" as const },
  { id: "w2", at: "2026-10-27T18:00:00Z", channel: "Instagram", title: "Posted: \"Kimi K3.1 Pro reads a million tokens\"", tone: "success" as const },
  {
    id: "w3", at: "2026-10-28T09:00:00Z", channel: "X", title: "Failed: \"Issue 40 is out\"", tone: "danger" as const,
    error: { message: "The image could not be loaded from its link when it was time to post.", supportUrl: "https://support.buffer.com" },
  },
  { id: "w4", at: "2026-10-29T12:00:00Z", channel: "LinkedIn", title: "Posted: \"Kimi K3.1 Pro is open-weights, 3T-class\"", tone: "success" as const },
];

/** Delivery watch for last week, always in the past (storyShift in demo-clock.ts). */
export const demoDeliveries = (shift: number) => DELIVERIES.map((d) => ({ ...d, at: shiftIso(d.at, storyShift(shift)) }));

/** The example week shown to visitors who are not signed in: always next week, moved by `shift` days. */
export function demoWeekFor(shift: number): WeekModel {
  return { label: demoWeekLabel(shift), days: demoDays(shift), channels, slots, posts: demoPosts(shift), timeZone: "America/Toronto", startsAt: shiftIso(DEMO_BASE_START, shift).replace(".000Z", "Z") };
}

/** Example copy marks for the Delivery screen: the two sent posts also went to Telegram and Discord. */
export const deliveryCopies = {
  w1: [{ kind: "telegram" as const, state: "sent" as const }, { kind: "discord" as const, state: "sent" as const }],
  w2: [{ kind: "telegram" as const, state: "sent" as const }],
};
