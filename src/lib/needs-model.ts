/**
 * The "Needs you" list for a signed-in user, built only from facts in the Buffer snapshot: drafts waiting next week,
 * upcoming posts on a channel that cannot publish, posts from the last 7 days that did not go out, and how full next
 * week is. No item is shown that the data cannot back.
 */
import type { NeedItem } from "@/components/needs-you-view";
import type { Channel, Post } from "./buffer/queries";
import { deliveriesFromBuffer } from "./delivery-model";
import { postsBetween } from "./posts-between";
import { channelCheck } from "./preflight";
import { nextWeekRange, weekFromBuffer } from "./week-from-buffer";
import { countOpenSlots } from "./week-model";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const UPCOMING: Post["status"][] = ["draft", "needs_approval", "scheduled"];

export function needsFromBuffer(channels: Channel[], posts: Post[], now: Date, timeZone: string): NeedItem[] {
  const items: NeedItem[] = [];
  const byId = new Map(channels.map((c) => [c.id, c]));
  const range = nextWeekRange(now, timeZone);
  const weekPosts = postsBetween(posts, range.start, range.end);
  const week = weekFromBuffer(channels, weekPosts, range, timeZone);

  const drafts = weekPosts.filter((p) => p.status === "draft" || p.status === "needs_approval");
  if (drafts.length) {
    const names = [...new Set(drafts.map((p) => byId.get(p.channelId)?.name).filter(Boolean))].join(", ");
    items.push({ id: "drafts", tone: "warning", title: `${plural(drafts.length, "draft")} to approve`, detail: `Next week, on ${names}`, action: "Review", href: "/week" });
  }

  const blocked = postsBetween(posts, now, range.end).filter((p) => {
    const ch = byId.get(p.channelId);
    return UPCOMING.includes(p.status) && ch && channelCheck(ch).result === "fail";
  });
  if (blocked.length) {
    const ch = byId.get(blocked[0].channelId)!;
    items.push({ id: "willfail", tone: "danger", title: `${plural(blocked.length, "post")} would fail`, detail: channelCheck(ch).detail, action: "Open week", href: "/week" });
  }

  const pastRange = { start: new Date(now.getTime() - 7 * 86_400_000), end: now };
  const failed = deliveriesFromBuffer(channels, postsBetween(posts, pastRange.start, pastRange.end), pastRange, now).filter((d) => d.tone === "danger");
  if (failed.length) {
    const first = failed[0];
    items.push({ id: "failed", tone: "danger", title: `${plural(failed.length, "post")} did not go out`, detail: `${first.channel}: ${first.error?.message ?? first.title}`, action: "Open delivery", href: "/delivery" });
  }

  const total = week.channels.reduce((sum, c) => sum + Object.values(week.slots[c.id] ?? {}).reduce((s, t) => s + t.length, 0), 0);
  if (total > 0) {
    const open = countOpenSlots(week);
    items.push(open === 0
      ? { id: "filled", tone: "success", title: `Next week: all ${plural(total, "slot")} have a post or draft`, detail: week.label, action: "Open week", href: "/week" }
      : { id: "open", tone: "warning", title: `${plural(open, "empty slot")} next week`, detail: `${total - open} of ${total} filled · ${week.label}`, action: "Write one", href: "/week?new=1" });
  }
  return items;
}
