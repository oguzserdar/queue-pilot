/**
 * @fileoverview Plain words for each security event, as the Security tab in Settings shows them: what happened,
 * who or where it came from, and when (in UTC, so the page never shifts between renders).
 */
import { appWords } from "./app-identity";
import { deviceName } from "./device-name";
import type { SecurityEvent } from "./security-events";

/** One line of the security activity list, already worded and dated. */
export type ShownSecurityEvent = { what: string; where: string | null; when: string; items?: string[] };

const NO_TIME = "no time set";

/** One draft's account and slot, from draftSlot's "LinkedIn|Alex|<iso>", as "LinkedIn (Alex), Tue 17 Nov 12:00 UTC". */
function slotWords(slot: string): string {
  const [network, name, at] = slot.split("|");
  const who = name ? `${network} (${name})` : network;
  const when = at && !Number.isNaN(Date.parse(at))
    ? new Date(at).toLocaleString("en-GB", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).replace(",", "") + " UTC"
    : NO_TIME;
  return `${who}, ${when}`;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** What happened, in words. */
function what(e: SecurityEvent): string {
  const d = e.detail ?? {};
  const count = Number(d.count ?? "1") || 1;
  // A delete records one thing per line, but its ids can include linked posts; times is how many lines were folded.
  const times = Number(d.times ?? "1") || 1;
  switch (e.event) {
    case "sign_in": return "Signed in";
    // Older removals carry no verified flag and keep the name they were recorded with.
    case "app_revoked": return d.app ? `Removed ${appWords({ name: d.app, verified: d.verified !== "false" })}` : "Removed an AI app";
    case "account_deleted": return "Account deleted";
    case "app_connected": return d.app ?? d.by ? `Connected ${appWords({ name: (d.app ?? d.by)!, verified: d.verified !== "false" })}` : "Connected an AI app";
    case "drafts_approved": return `Scheduled ${plural(count, "draft")}`;
    case "draft_deleted": return times > 1 ? `Deleted ${plural(times, "draft")}` : "Deleted a draft";
    case "content_item_deleted": return times > 1 ? `Deleted ${plural(times, "post")} kept before choosing accounts` : "Deleted a post kept before choosing accounts";
    case "tag_deleted": return d.name ? `Deleted the tag "${d.name}"` : "Deleted a tag";
    case "snippet_deleted": return times > 1 ? `Deleted ${plural(times, "hashtag set")}` : "Deleted a hashtag set";
    case "note_deleted": return times > 1 ? `Deleted ${plural(times, "note")}` : "Deleted a note";
    case "direct_post_sent":
    case "announcement_sent": return d.name ? `Posted to ${d.name}` : "Posted to Telegram or Discord";
  }
}

/** Who did it for actions, or the browser and address for a sign-in. */
function where(e: SecurityEvent): string | null {
  const by = e.detail?.by;
  if (e.event !== "app_connected" && by) {
    if (e.detail?.via === "app") return "You, in Queue Pilot";
    return e.detail?.verified === "false" ? `By ${appWords({ name: by, verified: false })}` : `By ${by}, a connected AI app`;
  }
  return [e.userAgent ? deviceName(e.userAgent) : null, e.ip].filter(Boolean).join(", ") || null;
}

/**
 * Words for one security event.
 *
 * @param e - The event as recorded
 * @returns What happened, where or by whom, and when in UTC
 */
export function showSecurityEvent(e: SecurityEvent): ShownSecurityEvent {
  const when = new Date(e.createdAt).toLocaleString("en-GB", { timeZone: "UTC", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) + " UTC";
  const slots = e.detail?.slots?.split("\n").filter(Boolean) ?? [];
  return { what: what(e), where: where(e), when, ...(slots.length ? { items: slots.map(slotWords) } : {}) };
}

/** Actions that read as one line when the same person or app repeats them within a minute. */
const REPEATABLE = new Set<SecurityEvent["event"]>(["drafts_approved", "draft_deleted", "content_item_deleted", "snippet_deleted", "note_deleted"]);

/** True when b repeats a: the same action, by the same person or app, in the same minute. */
function repeats(a: SecurityEvent, b: SecurityEvent): boolean {
  const da = a.detail ?? {}, db = b.detail ?? {};
  return REPEATABLE.has(a.event) && a.event === b.event && da.by === db.by && da.via === db.via && da.verified === db.verified
    && a.createdAt.slice(0, 16) === b.createdAt.slice(0, 16);
}

/**
 * Words for a page of security events, with repeats folded into one line: nine drafts deleted by Claude in the same
 * minute read "Deleted 9 drafts", not nine identical lines. Only neighbours fold, so the order stays as recorded.
 *
 * @param events - Events newest first, as recorded
 * @returns One worded line per action or run of repeats
 */
export function showSecurityEvents(events: SecurityEvent[]): ShownSecurityEvent[] {
  const folded: SecurityEvent[] = [];
  for (const e of events) {
    const prev = folded.at(-1);
    if (prev && repeats(prev, e)) {
      // Schedules add up their drafts; deletes add up lines, since one delete is one thing.
      const sum = (k: "count" | "times") => (Number(prev.detail?.[k] ?? "1") || 1) + (Number(e.detail?.[k] ?? "1") || 1);
      const slots = [prev.detail?.slots, e.detail?.slots].filter(Boolean).join("\n");
      folded[folded.length - 1] = { ...prev, detail: { ...prev.detail, ...(prev.event === "drafts_approved" ? { count: String(sum("count")) } : { times: String(sum("times")) }), ...(slots ? { slots } : {}) } };
    } else folded.push(e);
  }
  return folded.map(showSecurityEvent);
}
