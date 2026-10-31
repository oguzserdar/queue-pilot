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

/** Why something needs the person; the groups appear in this order. */
export const TRIAGE_GROUPS = [
  { kind: "breaks", label: "Won't go out as it is" },
  { kind: "failed", label: "Didn't go out" },
  { kind: "approve", label: "Ready to approve" },
  { kind: "check", label: "Check before approving" },
  { kind: "comment", label: "Reviewers said" },
  { kind: "empty", label: "Empty times" },
] as const;
export type TriageKind = (typeof TRIAGE_GROUPS)[number]["kind"];

/** One line. `postId` is set for a draft Queue Pilot wrote, so it can be approved from here. */
export type TriageItem = { id: string; kind: TriageKind; title: string; detail: string; href: string; action: string; postId?: string };

/** A draft's playbook state: checked and fine, needing a fresh check, or breaking a rule. */
export type DraftCheck = "ok" | "check" | "breaks";

const short = (t: string, n = 90) => (t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t);

export function triageFromBuffer(input: {
  channels: Channel[];
  posts: Post[];
  now: Date;
  timeZone: string;
  /** Drafts Queue Pilot wrote, with their playbook state. A draft missing here is not Queue Pilot's. */
  checks: Record<string, DraftCheck>;
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
    const state = checks[p.id];
    if (worstTone(p) === "danger" || state === "breaks") {
      const why = p.checks?.find((c) => c.tone === "danger")?.label ?? "It breaks a rule in your playbook.";
      items.push({ id: `breaks-${p.id}`, kind: "breaks", title: short(p.text), detail: `${where} · ${why}`, href: "/week", action: "Fix" });
    } else if (state === "ok") items.push({ id: `approve-${p.id}`, kind: "approve", title: short(p.text), detail: where, href: "/week", action: "Approve", postId: p.id });
    else if (state === "check") items.push({ id: `check-${p.id}`, kind: "check", title: short(p.text), detail: `${where} · The rules changed since it was checked`, href: "/week", action: "Approve", postId: p.id });
  }

  const past = { start: new Date(now.getTime() - 7 * 86_400_000), end: now };
  for (const d of deliveriesFromBuffer(channels, postsBetween(posts, past.start, past.end), past, now).filter((d) => d.tone === "danger"))
    items.push({ id: `failed-${d.id}`, kind: "failed", title: d.title, detail: `${d.channel} · ${d.error?.message ?? "Buffer did not say why."}`, href: "/delivery", action: "See why" });

  for (const c of comments)
    items.push({ id: `comment-${c.id}`, kind: "comment", title: `${c.name}: "${short(c.text, 70)}"`, detail: `On "${short(c.draft, 50)}"`, href: "/reviews", action: "Suggest edits" });

  for (const ch of week.channels.filter((c) => !c.isDisconnected))
    for (let day = 0; day < 7; day++)
      for (const e of cellEntries(week, ch.id, day))
        if (e.slot && !e.posts.some((p) => p.status !== "error"))
          items.push({ id: `empty-${ch.id}-${day}-${e.time}`, kind: "empty", title: `${week.days[day]} ${e.time} · ${ch.name}`, detail: "No post yet", href: "/week?new=1", action: "Write" });

  return items;
}
