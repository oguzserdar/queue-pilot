/**
 * @fileoverview Plain words for each security event, as the Security tab in Settings shows them: what happened,
 * who or where it came from, and when (in UTC, so the page never shifts between renders).
 */
import { appWords } from "./app-identity";
import { deviceName } from "./device-name";
import type { SecurityEvent } from "./security-events";

/** One line of the security activity list, already worded and dated. */
export type ShownSecurityEvent = { what: string; where: string | null; when: string };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** What happened, in words. */
function what(e: SecurityEvent): string {
  const d = e.detail ?? {};
  const count = Number(d.count ?? "1") || 1;
  switch (e.event) {
    case "sign_in": return "Signed in";
    case "app_revoked": return `Removed ${d.app ?? "an AI app"}`;
    case "account_deleted": return "Account deleted";
    case "app_connected": return d.app ?? d.by ? `Connected ${appWords({ name: (d.app ?? d.by)!, verified: d.verified !== "false" })}` : "Connected an AI app";
    case "drafts_approved": return `Scheduled ${plural(count, "draft")}`;
    case "draft_deleted": return "Deleted a draft";
    case "content_item_deleted": return "Deleted a post kept before choosing accounts";
    case "tag_deleted": return d.name ? `Deleted the tag "${d.name}"` : "Deleted a tag";
    case "snippet_deleted": return "Deleted a hashtag set";
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
  return { what: what(e), where: where(e), when };
}
