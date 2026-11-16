/**
 * The week's words and counts, worked out from the week and its drafts: each draft's checks, where a rule came from,
 * the example's replay of a fill, and the title and line under it (src/components/week-view.tsx).
 */
import type { Readiness } from "@/lib/draft-readiness";
import type { Rule } from "@/lib/rules";
import type { Verdict } from "@/lib/judge";
import type { WritingAvailability } from "@/lib/writing-availability";
import { ruleOrigin } from "@/lib/rule-origin";
import { countOpenSlots, slotKey, worstTone, type WeekModel, type WeekPost } from "@/lib/week-model";

export type Result = { ok: true; title?: string } | { ok: false; message: string };

export type Fill = { ids: Set<string>; texts: Record<string, string> };

/** A draft's checks as the week shows them: a live draft that needs a look, or was saved unchecked, gets one more row. */
export function postChecks(p: WeekPost, live: boolean, readiness: Readiness | undefined, verdict: Verdict[] | null | undefined, checkNote: string | undefined): WeekPost["checks"] {
  if (!live || p.status !== "draft") return p.checks;
  if (readiness && readiness.state !== "ok") return [...(p.checks ?? []), { tone: readiness.state === "breaks" ? "danger" as const : "warning" as const, label: readiness.reason ?? "Check this draft before approving." }];
  if (verdict === null) return [...(p.checks ?? []), { tone: "warning" as const, label: checkNote ?? "Needs a current playbook check." }];
  return p.checks;
}

/** Where a rule came from, from its record (or the example's own words); nothing when nothing was recorded. */
export function originFor(rules: Rule[], ruleId: string): string | null {
  const r = rules.find((x) => x.id === ruleId);
  if (!r) return null;
  const said = "origin" in r && typeof r.origin === "string" ? r.origin : null;
  return ruleOrigin(r) ?? said;
}

/**
 * The example replays a fill on its own week: its drafts step aside, their times are written again one by one with
 * the same text, and they come back when the run ends. Its empty times get a sample line, which stays. A post that
 * would fail is left out: a fill never writes over a post that is already there.
 */
export function exampleSamples(week: WeekModel, posts: WeekPost[], drafts: WeekPost[], cellId: (c: string, day: number, t: string) => string) {
  const samples: { slotId: string; text?: string }[] = [];
  const replayed = new Set<string>();
  for (const p of drafts.filter((d) => worstTone(d) !== "danger").sort((x, y) => x.day - y.day || x.time.localeCompare(y.time))) { samples.push({ slotId: cellId(p.channel, p.day, p.time), text: p.text }); replayed.add(p.id); }
  const taken = (c: string, day: number, t: string) => posts.some((p) => p.channel === c && p.day === day && p.time === t && p.status !== "error");
  for (const c of week.channels) {
    for (const [day, times] of Object.entries(week.slots[c.id] ?? {})) {
      for (const t of times.filter((x) => !taken(c.id, Number(day), x))) samples.push({ slotId: cellId(c.id, Number(day), t) });
    }
  }
  return { samples, replayed };
}

/** The title's count of what is waiting, approved, held back and still empty. */
export function draftSummary(c: { toApprove: number; takenOff: number; held: number; overdue: number; approved: number; open: number }): string {
  return [
    c.toApprove && `${c.toApprove} draft${c.toApprove === 1 ? "" : "s"} to approve`,
    c.takenOff && `${c.takenOff} taken off the schedule`,
    c.held && `${c.held} held back`,
    c.overdue && `${c.overdue} overdue`,
    c.approved > 0 && `${c.approved} approved`,
    c.open ? `${c.open} empty time${c.open === 1 ? "" : "s"}` : "every time filled",
  ].filter(Boolean).join(", ");
}

export type Counts = { channels: WeekModel["channels"]; drafts: number; posts: number; open: number; hasTimes: boolean; toApprove: number; takenOff: number; held: number; overdue: number; waiting: number; blocked: number };

/** The page title: the week's name and what it holds. */
export function weekTitle(name: string, c: Counts): string {
  if (c.channels.length === 0) return name;
  if (c.drafts > 0) return `${name}: ${draftSummary({ ...c, approved: c.drafts - c.waiting - c.overdue - c.takenOff })}`;
  if (c.open === 0 && !c.posts && !c.hasTimes) return `${name}: ${c.channels.length && c.channels.every((ch) => ch.isQueuePaused) ? "your Buffer queue is paused" : "no posting times set in Buffer"}`;
  return c.open === 0 ? `${name}: every time has a post` : `${name}: ${c.open} empty time${c.open === 1 ? "" : "s"}`;
}

/** Why there are no posting times to fill. */
export function noTimesLine(noBuffer: boolean, channels: WeekModel["channels"]): string {
  if (noBuffer) return "Set posting times on your accounts in Settings, and they show here to fill.";
  return channels.every((c) => c.isQueuePaused) ? "Resume your queue in Buffer, and its posting times show here to fill." : "Add posting times to your channels in Buffer, and they show here to fill.";
}

/** The line under the title: what is waiting, or how the week gets filled. */
export function weekSub(c: Counts, p: { live: boolean; noBuffer: boolean; which: "this" | "next"; writing: WritingAvailability | undefined }): string {
  if (c.channels.length === 0) return "Nothing to fill yet.";
  if (!c.hasTimes && !c.posts) return noTimesLine(p.noBuffer, c.channels);
  if (c.drafts > 0) {
    const waiting = c.waiting ? `${c.waiting} waiting for your approval` : "No drafts from Queue Pilot are waiting for approval";
    return `${p.live ? waiting : "Written from your newsletter, each one checked against your playbook"}${c.blocked ? `. ${c.blocked} can't go out until ${c.blocked === 1 ? "its" : "their"} problem is fixed` : ""}.`;
  }
  if (p.noBuffer) return "Press + Add on an empty time to write a post for it. Queue Pilot posts it at that time.";
  return p.writing?.ready ? `Fill ${p.which} week writes drafts into your empty Buffer posting times. Or connect your AI and ask it to fill your week.` : "Connect your AI and ask it to fill your week.";
}

/** What the week is drawn from: the week, what the person changed or approved on this page, and the server's facts. */
export type FactsInput = {
  week: WeekModel;
  live: boolean;
  verdicts: Record<string, Verdict[] | null>;
  readiness: Record<string, Readiness>;
  checkNotes: Record<string, string>;
  nowIso?: string;
  pulledBack: string[];
  gone: Set<string>;
  edited: Record<string, string>;
  approved: Map<string, string>;
};

/** A posting time that has passed, by the server's clock; only the week today is in has any. */
function passedTest(week: WeekModel, nowIso?: string) {
  const builtAt = nowIso ? Date.parse(nowIso) : null;
  return (channelId: string, day: number, t: string) => {
    const id = week.slotIds?.[slotKey(channelId, day, t)];
    return builtAt !== null && !!id && Date.parse(id.slice(id.lastIndexOf("@") + 1)) <= builtAt;
  };
}

/** The week's posts as shown, with each draft's checks, and the times that have passed with nothing in them. */
function shownPosts(f: FactsInput) {
  // Example mode shows its own edits and deletions on screen; live mode refreshes from the server instead.
  const posts = f.week.posts.filter((p) => !f.gone.has(p.id)).map((p) => ({
    ...p,
    text: f.edited[p.id] ?? p.text,
    checks: postChecks(p, f.live, f.readiness[p.id], f.verdicts[p.id], f.checkNotes[p.id]),
    // Live verdict entries come from this person's writing records, including drafts saved unchecked.
    ours: f.live ? Object.hasOwn(f.verdicts, p.id) : p.ours,
  }));
  return posts;
}

/** Everything the week page counts: posts, drafts, overdue and ready ones, empty times, and the title's numbers. */
export function weekFacts(f: FactsInput) {
  const { week, live, readiness, approved } = f;
  const { channels, slots } = week;
  const posts = shownPosts(f);
  const drafts = posts.filter((p) => p.status === "draft");
  const passed = passedTest(week, f.nowIso);
  // A draft whose time passed is never posted by Buffer and cannot be approved; it is named apart from the rest.
  const overdue = new Set(drafts.filter((p) => passed(p.channel, p.day, p.time)).map((p) => p.id));
  const taken = (c: string, day: number, t: string) => posts.some((p) => p.channel === c && p.day === day && p.time === t && p.status !== "error");
  const passedEmpty = channels.reduce((n, c) => n + Object.entries(slots[c.id] ?? {}).reduce((m, [day, times]) => m + times.filter((t) => passed(c.id, Number(day), t) && !taken(c.id, Number(day), t)).length, 0), 0);
  const open = countOpenSlots({ ...week, posts }) - passedEmpty;
  // No times at all is not a full week: the queue is paused, or Buffer has no posting times for it.
  const hasTimes = channels.some((c) => Object.values(slots[c.id] ?? {}).some((times) => times.length));
  const needsCheck = (id: string) => live && (readiness[id]?.state === "check" || readiness[id]?.state === "breaks");
  const pulled = new Set(f.pulledBack);
  const mine = drafts.filter((p) => p.ours !== false && !approved.has(p.id));
  const ready = mine.filter((p) => worstTone(p) !== "danger" && !needsCheck(p.id) && !overdue.has(p.id) && !pulled.has(p.id));
  const blocked = drafts.filter((p) => worstTone(p) === "danger");
  const waitingNow = mine.filter((p) => !overdue.has(p.id) && !pulled.has(p.id));
  // The title counts what Approve can act on; a post that would fail is named apart, so the two numbers always agree.
  const counts: Counts = {
    channels, drafts: drafts.length, posts: posts.length, open, hasTimes, overdue: overdue.size, blocked: blocked.length,
    held: blocked.filter((p) => p.ours !== false && !approved.has(p.id)).length,
    // Posts the person took off the schedule are counted on their own, not as drafts waiting for approval.
    takenOff: mine.filter((p) => pulled.has(p.id)).length,
    waiting: waitingNow.length,
    toApprove: waitingNow.filter((p) => worstTone(p) !== "danger").length,
  };
  return { posts, drafts, passed, overdue, open, needsCheck, pulled, ready, blocked, counts };
}

/**
 * A channel or account name cut into the pieces it may wrap between: before an "@" that is not the first character
 * and after a dot, so a handle such as "@ada@mastodon.social" wraps as "@ada" / "@mastodon." / "social", never
 * mid-word. Joined back, the pieces are the name unchanged.
 *
 * @param name - The name as shown
 * @returns The name in order, split at those points
 */
export function namePieces(name: string): string[] {
  return name.split(/(?<=\.)|(?<=.)(?=@)/u).filter((piece) => piece !== "");
}
