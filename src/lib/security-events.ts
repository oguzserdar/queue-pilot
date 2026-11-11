/**
 * @fileoverview Security events: what the person sees under "Security activity" in Settings. Besides sign-ins and
 * removed apps, it records each consequential action (connecting an AI app, scheduling drafts, deleting a draft,
 * content item, tag, hashtag set or Buffer note) with who did it: the connected app's name, or Queue Pilot for the app's own
 * buttons. Only counts, ids and names of labels are kept, never post text.
 *
 * Recording never throws: a failed write is logged and the action it describes still completes.
 */
import { and, eq } from "drizzle-orm";
import { readPage, timeText, type PageFrom } from "./page-bookmark";
import { db } from "../db";
import { securityEvent } from "../db/schema";
import { capAppName } from "./app-identity";
import { NETWORKS } from "./rules";

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
 * @param facts - Ids it touched, an optional label name (a tag's name), and the account and time of each draft
 *   touched (from {@link draftSlot}); never post text
 */
export async function recordAction(userId: string, event: ActionEventKind, by: Actor, facts: { ids?: string[]; name?: string; slots?: (string | null)[] } = {}): Promise<void> {
  const slots = (facts.slots ?? []).filter((x): x is string => Boolean(x));
  const ids = facts.ids ?? [];
  const detail: Record<string, string> = {
    by: by.via === "ai" ? capAppName(by.app) || "An AI app" : IN_APP,
    via: by.via,
    // An app whose address did not prove its name: Settings words it as "an unverified app named …".
    ...(by.via === "ai" && by.verified === false ? { verified: "false" } : {}),
    ...(ids.length ? { count: String(ids.length), ids: ids.slice(0, MAX_IDS).join(",") } : {}),
    ...(facts.name ? { name: facts.name.slice(0, 100) } : {}),
    ...(slots.length ? { slots: slots.slice(0, MAX_IDS).join("\n") } : {}),
  };
  await recordSecurityEvent(userId, event, { detail });
}

/**
 * Which draft it was, without its text: the network, the account's name and the time slot, as "LinkedIn|Alex|<iso>".
 * Security activity shows it as "LinkedIn (Alex), Tue 17 Nov 12:00 UTC", so a deleted draft can still be recognised.
 *
 * @param post - The draft, read before it was deleted
 * @param channels - The person's Buffer accounts
 * @returns The slot, or null when the draft is not in the copy
 */
export function draftSlot(post: { channelId: string; dueAt: string | null } | undefined, channels: { id: string; name: string; service: string }[]): string | null {
  if (!post) return null;
  const c = channels.find((x) => x.id === post.channelId);
  const clean = (t: string) => t.replace(/[|\n]/g, " ").slice(0, 60);
  return [clean(c ? NETWORKS[c.service] ?? c.service : "An account"), clean(c?.name ?? ""), post.dueAt ?? ""].join("|");
}

/** How many events one page of Security activity shows. */
export const SECURITY_PAGE_SIZE = 25;

/** One page of events, newest first, with bookmarks for the next older and newer pages (null when there is none). */
export type SecurityEventPage = { events: SecurityEvent[]; older: string | null; newer: string | null };

/**
 * One page of the person's security events, newest first.
 *
 * @param userId - The signed-in person
 * @param from - A bookmark from the page before or after; neither, or an unreadable one, opens the newest page
 * @param limit - How many to return
 * @returns The events and the bookmarks either side
 */
export async function securityEventPage(userId: string, from: PageFrom = {}, limit = SECURITY_PAGE_SIZE): Promise<SecurityEventPage> {
  const page = await readPage({
    time: securityEvent.createdAt,
    key: securityEvent.id,
    from,
    limit,
    read: async (where, order, count) =>
      (await db().select({ row: securityEvent, at: timeText(securityEvent.createdAt) }).from(securityEvent).where(and(eq(securityEvent.userId, userId), where)).orderBy(...order).limit(count))
        .map((r) => ({ ...r, key: r.row.id })),
  });
  return {
    events: page.rows.map((r) => ({ event: r.event as SecurityEventKind, detail: r.detail ?? null, ip: r.ip, userAgent: r.userAgent, createdAt: r.createdAt.toISOString() })),
    older: page.older,
    newer: page.newer,
  };
}

/**
 * The person's most recent security events, newest first.
 *
 * @param userId - The signed-in person
 * @param limit - How many to return
 */
export async function recentSecurityEvents(userId: string, limit = 20): Promise<SecurityEvent[]> {
  return (await securityEventPage(userId, {}, limit)).events;
}
