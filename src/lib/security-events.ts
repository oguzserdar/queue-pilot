/**
 * @fileoverview Security events: what the person sees under "Security activity" in Settings. Besides sign-ins and
 * removed apps, it records each consequential action (connecting an AI app, scheduling drafts, deleting a draft,
 * content item, tag, hashtag set or Buffer note) with who did it: the connected app's name, or Queue Pilot for the app's own
 * buttons. Only counts, ids and names of labels are kept, never post text.
 *
 * Recording never throws: a failed write is logged and the action it describes still completes.
 */
import { desc, eq } from "drizzle-orm";
import { db } from "../db";
import { securityEvent } from "../db/schema";
import { capAppName } from "./app-identity";

/** Actions that change what goes out or remove something, recorded with who did them. */
export const ACTION_EVENTS = ["app_connected", "drafts_approved", "draft_deleted", "content_item_deleted", "tag_deleted", "snippet_deleted", "note_deleted", "direct_post_sent"] as const;
export type ActionEventKind = (typeof ACTION_EVENTS)[number];

/** "announcement_sent" is the name direct posts were recorded under on 8 Nov before the rename; old rows keep it. */
export type SecurityEventKind = "sign_in" | "app_revoked" | "account_deleted" | "announcement_sent" | ActionEventKind;

export type SecurityEvent = {
  event: SecurityEventKind;
  detail: Record<string, string> | null;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
};

/** The name recorded for actions taken with Queue Pilot's own buttons. */
export const IN_APP = "Queue Pilot";

/** Who took an action: a connected AI app by name, or the person in Queue Pilot itself. */
export type Actor = { via: "ai"; app: string; verified?: boolean } | { via: "app" };

/** At most this many ids are kept on one event, so a large batch cannot bloat the record. */
const MAX_IDS = 25;

/**
 * Records one security event.
 *
 * @param userId - The person, or null for the anonymous "account deleted" record
 * @param event - What happened
 * @param extra - Optional detail (for example the AI app's name), IP address and browser
 */
export async function recordSecurityEvent(
  userId: string | null,
  event: SecurityEventKind,
  extra: { detail?: Record<string, string>; ip?: string | null; userAgent?: string | null } = {},
): Promise<void> {
  try {
    await db().insert(securityEvent).values({ userId, event, detail: extra.detail ?? null, ip: extra.ip ?? null, userAgent: extra.userAgent ?? null });
  } catch (e) {
    console.error(JSON.stringify({ event: "qp-security-event-write-failed", kind: event, message: e instanceof Error ? e.message : String(e) }));
  }
}

/**
 * Records one consequential action with who took it. Never throws.
 *
 * @param userId - The person whose account it touched
 * @param event - What was done
 * @param by - The connected AI app, or the person in Queue Pilot
 * @param facts - Ids it touched and an optional label name (a tag's name); never post text
 */
export async function recordAction(userId: string, event: ActionEventKind, by: Actor, facts: { ids?: string[]; name?: string } = {}): Promise<void> {
  const ids = facts.ids ?? [];
  const detail: Record<string, string> = {
    by: by.via === "ai" ? capAppName(by.app) || "An AI app" : IN_APP,
    via: by.via,
    // An app whose address did not prove its name: Settings words it as "an unverified app named …".
    ...(by.via === "ai" && by.verified === false ? { verified: "false" } : {}),
    ...(ids.length ? { count: String(ids.length), ids: ids.slice(0, MAX_IDS).join(",") } : {}),
    ...(facts.name ? { name: facts.name.slice(0, 100) } : {}),
  };
  await recordSecurityEvent(userId, event, { detail });
}

/**
 * The person's most recent security events, newest first.
 *
 * @param userId - The signed-in person
 * @param limit - How many to return
 */
export async function recentSecurityEvents(userId: string, limit = 20): Promise<SecurityEvent[]> {
  const rows = await db().select().from(securityEvent).where(eq(securityEvent.userId, userId)).orderBy(desc(securityEvent.createdAt)).limit(limit);
  return rows.map((r) => ({ event: r.event as SecurityEventKind, detail: r.detail ?? null, ip: r.ip, userAgent: r.userAgent, createdAt: r.createdAt.toISOString() }));
}
