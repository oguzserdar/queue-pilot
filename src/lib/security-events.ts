/**
 * @fileoverview Security events: what the person sees under "Security activity" in Settings. Besides sign-ins and
 * removed apps, it records each consequential action (connecting an AI app, scheduling drafts, deleting a draft,
 * content item, tag, hashtag set or Buffer note) with who did it: the connected app's name, or Queue Pilot for the app's own
 * buttons. Only counts, ids and names of labels are kept, never post text.
 *
 * Recording never throws: a failed write is logged and the action it describes still completes.
 */
import { and, asc, desc, eq, gt, lt, or, sql } from "drizzle-orm";
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

/** A timestamptz as Postgres writes it as text, for example 2026-11-10 03:10:12.123456+00. */
const PG_TIME = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d{1,6})?[+-]\d{2}(:\d{2})?$/;

/**
 * Reads a page bookmark: an event's time, as Postgres wrote it, and its id. The time stays as Postgres text because a
 * JavaScript date drops microseconds, which would skip events recorded in the same millisecond.
 */
function readBookmark(mark: string | null | undefined): { at: string; id: string } | null {
  if (!mark) return null;
  const cut = mark.lastIndexOf("~");
  const at = mark.slice(0, cut), id = mark.slice(cut + 1);
  if (cut < 1 || !id || !PG_TIME.test(at)) return null;
  return { at, id };
}

/** Events strictly older (or newer) than the bookmark, in the order time then id. */
function beyond(mark: { at: string; id: string }, side: "older" | "newer") {
  const at = sql`${mark.at}::timestamptz`;
  const cmp = side === "older" ? lt : gt;
  return or(cmp(securityEvent.createdAt, at), and(eq(securityEvent.createdAt, at), cmp(securityEvent.id, mark.id)));
}

/**
 * One page of the person's security events, newest first. Pages by bookmark rather than by offset, so an event
 * recorded while the person reads never shifts a page or repeats a line.
 *
 * @param userId - The signed-in person
 * @param from - `before`: a bookmark from a page's `older`, for the page after it; `after`: from `newer`, for the page
 *   before it; neither, or an unreadable bookmark, opens the newest page
 * @param limit - How many to return
 * @returns The events and the bookmarks either side
 */
export async function securityEventPage(userId: string, from: { before?: string | null; after?: string | null } = {}, limit = SECURITY_PAGE_SIZE): Promise<SecurityEventPage> {
  const before = readBookmark(from.before);
  const after = before ? null : readBookmark(from.after);
  const at = sql<string>`${securityEvent.createdAt}::text`;
  const mine = eq(securityEvent.userId, userId);
  // Walking newer reads upward from the bookmark, then turns the rows back to newest first.
  const rows = await db()
    .select({ row: securityEvent, at })
    .from(securityEvent)
    .where(and(mine, before ? beyond(before, "older") : after ? beyond(after, "newer") : undefined))
    .orderBy(...(after ? [asc(securityEvent.createdAt), asc(securityEvent.id)] : [desc(securityEvent.createdAt), desc(securityEvent.id)]))
    .limit(limit + 1);
  const more = rows.length > limit;
  const page = after ? rows.slice(0, limit).reverse() : rows.slice(0, limit);
  const mark = (r: (typeof rows)[number] | undefined) => (r ? `${r.at}~${r.row.id}` : null);
  const first = page[0], last = page.at(-1);
  // The side the reader came from always has a page; the far side has one when the extra row came back.
  const anyNewer = after ? more : Boolean(before && first);
  const anyOlder = after ? Boolean(last) : more;
  return {
    events: page.map(({ row: r }) => ({ event: r.event as SecurityEventKind, detail: r.detail ?? null, ip: r.ip, userAgent: r.userAgent, createdAt: r.createdAt.toISOString() })),
    older: anyOlder ? mark(last) : null,
    newer: anyNewer ? mark(first) : null,
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
