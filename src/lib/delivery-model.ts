/**
 * What the Delivery screen shows: last week's posts that were due, whether each went out, and Buffer's reason when not.
 */
import type { Channel, Post as BufferPost } from "./buffer/queries";

export type DeliveryItem = {
  id: string;
  /** ISO time the post was due. */
  at: string;
  channel: string;
  /** Channel timezone, so times read as the user scheduled them. */
  timeZone?: string;
  title: string;
  tone: "success" | "danger" | "warning";
  error?: { message: string; supportUrl: string };
};

const GRACE_MS = 15 * 60 * 1000;
const quote = (text: string) => `"${text.length > 60 ? `${text.slice(0, 57).trimEnd()}…` : text}"`;

/** Posts due in [start, end): sent → went out, error → failed, still scheduled 15 min after its time → late. */
export function deliveriesFromBuffer(channels: Channel[], posts: BufferPost[], range: { start: Date; end: Date }, now: Date): DeliveryItem[] {
  const byId = new Map(channels.map((c) => [c.id, c]));
  const items: DeliveryItem[] = [];
  for (const p of posts) {
    const ch = byId.get(p.channelId);
    if (!ch || !p.dueAt) continue;
    const at = new Date(p.dueAt);
    if (at < range.start || at >= range.end || at.getTime() > now.getTime() - GRACE_MS) continue;
    const base = { id: p.id, at: at.toISOString(), channel: ch.name, timeZone: ch.timezone };
    if (p.status === "sent") items.push({ ...base, title: `Posted: ${quote(p.text)}`, tone: "success" });
    else if (p.status === "error")
      items.push({ ...base, title: `Failed: ${quote(p.text)}`, tone: "danger", error: { message: p.error?.message ?? "Buffer marked this post as failed without a reason.", supportUrl: p.error?.supportUrl ?? "https://support.buffer.com" } });
    else if (p.status === "scheduled" || p.status === "sending") items.push({ ...base, title: `Late: ${quote(p.text)}`, tone: "warning" });
  }
  return items.sort((a, b) => a.at.localeCompare(b.at));
}
