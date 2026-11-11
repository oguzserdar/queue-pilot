/**
 * "Needs you" as a triage list: one line per thing, grouped by why it needs the person, each with its one action.
 * Built only from facts the Buffer snapshot, the playbook checks and the review links back.
 */
import type { Channel, Post } from "./buffer/queries";
import type { ReviewComment } from "./review-limits";
import { deliveriesFromBuffer } from "./delivery-model";
import { postsBetween } from "./posts-between";
import { nextWeekRange, weekFromBuffer } from "./week-from-buffer";
import { cellEntries, worstTone } from "./week-model";
import type { Readiness } from "./draft-readiness";
import { BUFFER_PUBLISH_URL } from "./connect-links";

/** Why something needs the person; the groups appear in this order. */
export const TRIAGE_GROUPS = [
  { kind: "breaks", label: "Won't go out as it is" },
  { kind: "failed", label: "Didn't go out" },
  { kind: "overdue", label: "Overdue in Buffer" },
  { kind: "approve", label: "Ready to approve" },
  { kind: "check", label: "Check before approving" },
  { kind: "comment", label: "Reviewers said" },
  { kind: "empty", label: "Empty times" },
] as const;
export type TriageKind = (typeof TRIAGE_GROUPS)[number]["kind"];

/**
 * One line. `postId` is set on a draft Queue Pilot wrote: `approve` rows can be approved from here, and `recheck`
 * rows run Check again. Other check rows open Next week to read the draft.
 */
/** `full` and `why`, when present, are the whole post and the whole reason, shown on hover; the row keeps one line of each. */
export type TriageItem = { id: string; kind: TriageKind; title: string; detail: string; href: string; action: string; postId?: string; run?: "approve" | "recheck"; full?: string; why?: string; /** For the empty-times line: how many empty times it stands for. */ count?: number };

const short = (t: string, n = 200) => (t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t);

export function triageFromBuffer(input: {
  channels: Channel[];
  posts: Post[];
  now: Date;
  timeZone: string;
  /** Drafts Queue Pilot wrote, with whether their last check lets them go out. A draft missing here is not Queue Pilot's. */
  checks: Record<string, Readiness>;
  /** Review comments from the last seven days, with the draft each was left on. */
  comments: (ReviewComment & { draft: string })[];
}): TriageItem[] {
  const { channels, posts, now, timeZone, checks, comments } = input;
  const range = nextWeekRange(now, timeZone);
  const week = weekFromBuffer(channels, postsBetween(posts, range.start, range.end), range, timeZone);
  const name = (id: string) => channels.find((c) => c.id === id)?.name ?? "Account";
  const items: TriageItem[] = [];

  for (const p of week.posts.filter((p) => p.status === "draft")) {
    const where = `${week.days[p.day]} ${p.time} · ${name(p.channel)}`;
    const r = checks[p.id];
    if (worstTone(p) === "danger" || r?.state === "breaks") {
      const why = p.checks?.find((c) => c.tone === "danger")?.label ?? r?.reason ?? "It breaks a rule in your playbook.";
      items.push({ id: `breaks-${p.id}`, kind: "breaks", title: short(p.text), detail: where, href: "/week", action: "Fix", full: p.text, why });
    } else if (r?.state === "ok" || r?.state === "flagged") items.push({ id: `approve-${p.id}`, kind: "approve", title: short(p.text), detail: where, href: "/week", action: "Approve", postId: p.id, run: "approve", full: p.text, why: r.reason ?? undefined });
    else if (r?.state === "check") items.push({ id: `check-${p.id}`, kind: "check", title: short(p.text), detail: where, href: "/week", action: r.stale ? "Check again" : "Read it", postId: p.id, run: r.stale ? "recheck" : undefined, full: p.text, why: r.reason });
  }

  const past = { start: new Date(now.getTime() - 7 * 86_400_000), end: now };
  for (const d of deliveriesFromBuffer(channels, postsBetween(posts, past.start, past.end), past, now).filter((d) => d.tone === "danger"))
    items.push({ id: `failed-${d.id}`, kind: "failed", title: d.title, detail: `${d.channel} · ${d.error?.message ?? "Buffer did not say why."}`, href: "/delivery", action: "See why", full: d.title, why: d.error?.message ?? "Buffer did not say why." });

  // A draft whose time passed is never posted: Buffer marks it Overdue and waits for a new time. Only the last seven
  // days are in the snapshot, so older ones are not counted here.
  const when = new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  for (const p of postsBetween(posts, past.start, past.end).filter((p) => p.status === "draft" && p.dueAt))
    items.push({ id: `overdue-${p.id}`, kind: "overdue", title: short(p.text), detail: `${when.format(new Date(p.dueAt!))} · ${name(p.channelId)}`, href: BUFFER_PUBLISH_URL, action: "Open Buffer", full: p.text, why: "Its time passed while it was a draft, so Buffer did not post it. Pick a new time or delete it in Buffer." });

  for (const c of comments)
    items.push({ id: `comment-${c.id}`, kind: "comment", title: `${c.name}: "${short(c.text, 70)}"`, detail: `On "${short(c.draft, 50)}"`, href: "/reviews", action: "Suggest edits", full: `${c.name}: "${c.text}"`, why: `On "${c.draft}"` });

  // Empty times are one line, never one per time: a new account can have dozens, and none of them is urgent.
  let empty = 0;
  for (const ch of week.channels.filter((c) => !c.isDisconnected))
    for (let day = 0; day < 7; day++)
      for (const e of cellEntries(week, ch.id, day))
        if (e.slot && !e.posts.some((p) => p.status !== "error")) empty++;
  if (empty) items.push({ id: "empty-week", kind: "empty", title: `${empty} empty time${empty === 1 ? "" : "s"} next week`, count: empty, detail: "No posts yet", href: "/week", action: "Open next week" });

  return items;
}
