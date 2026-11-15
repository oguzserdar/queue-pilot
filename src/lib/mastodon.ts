import "server-only";
/**
 * A person's own Mastodon account: posting a status (POST /api/v1/statuses, scope write:statuses), reading the
 * mentions sent to it (GET /api/v1/notifications, scope read:notifications) and replying to one. Every call goes
 * through the private-network guard: the instance address is the person's, so it is https only and never redirected.
 *
 * Sources (read 14 Nov 2026): docs.joinmastodon.org/methods/statuses ("Idempotency keys are stored for up to 1
 * hour"; in_reply_to_id "ID of the status being replied to"; visibility public, unlisted, private, direct),
 * /entities/Status (`url` may be null; `uri` is the federation id; `content` is HTML; visibility `direct` is
 * "Visible only to mentioned users."; in_reply_to_id nullable), /api/rate-limits (X-RateLimit-Reset is the reset timestamp). The
 * status code for a rate limit is not stated there; 429 is read as "wait".
 * - /methods/notifications: GET /api/v1/notifications needs read:notifications; types[] filters (3.5.0+); limit
 *   default 40, max 80; since_id, min_id, max_id; Link headers for the next and previous page; 401 for a bad token.
 * - /entities/Notification: `status` is attached for `mention` (and other types), so it is read as optional.
 * - /api/guidelines: ids are opaque strings, never compared or cast as numbers; min_id "sets a cursor at this ID and
 *   paginates forward".
 * - mastodon/mastodon at commit 296ca2874f3b7c02e79d2041b54f352a392f17ba: app/models/concerns/paginable.rb (since_id
 *   gives the newest page above the cutoff, so a backlog larger than one page loses the oldest; min_id gives the page
 *   immediately after it, reversed to newest first), app/controllers/api/v1/notifications_controller.rb (the
 *   rel="prev" link carries min_id = the newest id on the page), app/lib/text_formatter.rb (a link is split into
 *   invisible and ellipsis spans whose text joins back to the full address; a mention is an h-card `@<span>name</span>`), lib/sanitize_ext/sanitize_config.rb (remote content keeps p br span a
 *   del s pre blockquote code b strong u i em ul ol li ruby rt rp, so list items and blocks also end a line).
 *
 * So listMentions sends min_id, never since_id, and the next cursor is the newest id on the page.
 */
import * as z from "zod";
import { safeGet, safePost, type HttpAnswer } from "./safe-fetch";

/** Mastodon answered and refused, so nothing was posted. A rate limit carries how long to wait. */
export class MastodonError extends Error {
  constructor(message: string, readonly status: number, readonly retryAfterSeconds?: number) {
    super(message);
  }
}

/** How a POST reaches the instance; the guarded one in production, a fake in tests. */
export type Post = (url: URL, init: { headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<HttpAnswer>;

/** How an authenticated GET reaches the instance; the guarded one (no redirects) in production, a fake in tests. */
export type Get = (url: URL, init: { headers: Record<string, string>; signal?: AbortSignal }) => Promise<HttpAnswer>;

/** Who can see a status (Status entity `visibility`). */
export type Visibility = "public" | "unlisted" | "private" | "direct";

/** One mention of the account, as the reply engine reads it. */
export type MastodonMention = {
  /** The notification id; the paging cursor is built from these */
  id: string;
  /** The status that mentions the account; reply to this */
  statusId: string;
  accountId: string;
  /** user for a local account, user@domain for a remote one */
  acct: string;
  /** The status content with the HTML removed */
  text: string;
  /** The status's web link, or its federation uri when the instance gives no link */
  url: string;
  createdAt: string;
  visibility: Visibility;
  inReplyToId: string | null;
};

/** Mentions on one page: the most this instance gives in one call. */
export const MENTIONS_PAGE_LIMIT = 80;

/** The longest one call may take before it counts as no answer. */
export const MASTODON_TIMEOUT_MS = 20_000;

/**
 * Posts the exact text as a public status. The idempotency key makes a repeated call within an hour return the same
 * status instead of a second one.
 *
 * @param server - The instance's https origin, e.g. https://mastodon.social
 * @param token - The account's access token (write:statuses)
 * @param text - The status text, sent as is
 * @param idempotencyKey - Stable for this destination of this post
 * @returns The status id and its link (null when the instance gives none)
 * @throws MastodonError when the instance refuses (4xx); any other failure means it may or may not have landed
 */
export async function postStatus(server: string, token: string, text: string, idempotencyKey: string, post: Post = safePost, now: () => Date = () => new Date()): Promise<{ id: string; link: string | null }> {
  return createStatus(server, token, { status: text, visibility: "public" }, idempotencyKey, ACTIONS.post, post, now);
}

/**
 * Replies to one status with the exact text. The idempotency key works as in postStatus. Pass the mention's own
 * visibility so the reply is never more public than what it answers: a direct mention is answered as direct.
 *
 * A direct status reaches only the accounts it mentions, and nothing read here says in_reply_to_id adds the author,
 * so the text must contain `@acct` of the person being answered or a direct reply reaches nobody.
 *
 * @param server - The instance's https origin
 * @param token - The account's access token (write:statuses)
 * @param inReplyToStatusId - The mention's statusId
 * @param text - The reply text, sent as is; include `@acct` of the person answered
 * @param idempotencyKey - Stable for this reply
 * @param visibility - The mention's visibility
 * @returns The reply's status id and its link (null when the instance gives none)
 * @throws MastodonError when the instance refuses (4xx); any other failure means it may or may not have landed
 */
export async function replyTo(server: string, token: string, inReplyToStatusId: string, text: string, idempotencyKey: string, visibility: Visibility, post: Post = safePost, now: () => Date = () => new Date()): Promise<{ id: string; link: string | null }> {
  return createStatus(server, token, { status: text, in_reply_to_id: inReplyToStatusId, visibility }, idempotencyKey, ACTIONS.reply, post, now);
}

/**
 * Reads the mentions of the account that came after the cursor: the page immediately after it (min_id), returned
 * newest first, so calling again with nextSinceId walks forward without a gap. With no cursor this is the newest page,
 * which is history: the caller decides what of it to answer. A visibility the instance does not name is read as direct.
 *
 * @param server - The instance's https origin
 * @param token - The account's access token (read:notifications)
 * @param sinceId - nextSinceId from the previous call; omit for the newest page
 * @returns The mentions and the cursor for the next call (unchanged when there was nothing new)
 * @throws MastodonError when the instance refuses (4xx) or asks to wait (429); any other failure is not known
 */
export async function listMentions(server: string, token: string, sinceId?: string, get: Get = safeGet, now: () => Date = () => new Date()): Promise<{ mentions: MastodonMention[]; nextSinceId: string | undefined }> {
  const url = new URL("/api/v1/notifications", server);
  url.searchParams.append("types[]", "mention");
  url.searchParams.set("limit", String(MENTIONS_PAGE_LIMIT));
  if (sinceId) url.searchParams.set("min_id", sinceId);
  const res = await get(url, { headers: { authorization: `Bearer ${token}`, accept: "application/json" }, signal: AbortSignal.timeout(MASTODON_TIMEOUT_MS) });
  await check(res, ACTIONS.read, now);
  const page: unknown = await res.json().catch(() => null);
  if (!Array.isArray(page)) throw new Error("Mastodon answered without a list of notifications");
  const first = WithId.safeParse(page[0]);
  // The cursor moves past every notification on the page, including any skipped below, or a skipped one repeats forever.
  const nextSinceId = prevMinId(res.headers.get("link")) ?? (first.success ? first.data.id : sinceId);
  return { mentions: page.flatMap((n) => toMention(n) ?? []), nextSinceId };
}

/** Mastodon's HTML status content as plain text: paragraphs, line breaks and list items kept, tags dropped, entities decoded. */
export function htmlToText(html: string): string {
  const text = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/(li|blockquote|pre|ul|ol)>/gi, "\n")
    .replace(/<[^>]*>/g, "");
  return decodeEntities(text).replace(/\n{3,}/g, "\n\n").trim();
}

const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** One pass, so an escaped entity (&amp;lt;) becomes its text (&lt;) and is never decoded twice. */
function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (whole, name: string) => {
    if (name[0] === "#") {
      const code = name[1] === "x" || name[1] === "X" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return NAMED[name.toLowerCase()] ?? whole;
  });
}

/** The min_id in the rel="prev" Link, which the instance sets to the newest id on the page. The URL is never fetched. */
function prevMinId(link: string | null): string | undefined {
  for (const part of link?.split(",") ?? []) {
    const m = /<([^>]*)>\s*;\s*rel="?prev"?/i.exec(part);
    if (!m) continue;
    try {
      return new URL(m[1]).searchParams.get("min_id") ?? undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

// What each answer must hold, checked instead of trusted (docs.joinmastodon.org/entities/Notification, Status, Error).
// An unknown or missing visibility reads as "direct", the most private, so a reply never widens who sees it.
const MentionNotification = z.object({
  id: z.string(),
  type: z.literal("mention"),
  status: z.object({
    id: z.string(),
    account: z.object({ id: z.string(), acct: z.string() }),
    content: z.string().catch(""),
    url: z.string().optional().catch(undefined),
    uri: z.string().optional().catch(undefined),
    created_at: z.string().catch(""),
    visibility: z.enum(["public", "unlisted", "private", "direct"]).catch("direct"),
    in_reply_to_id: z.string().nullable().catch(null),
  }),
});
const WithId = z.object({ id: z.string() });
const CreatedStatus = z.object({ id: z.string(), url: z.string().nullable().catch(null) });
const ErrorAnswer = z.object({ error: z.string().optional().catch(undefined) }).catch({});

/** A mention notification with its status, or null for anything else. */
function toMention(raw: unknown): MastodonMention | null {
  const parsed = MentionNotification.safeParse(raw);
  if (!parsed.success) return null;
  const { id, status: s } = parsed.data;
  return {
    id,
    statusId: s.id,
    accountId: s.account.id,
    acct: s.account.acct,
    text: htmlToText(s.content),
    url: s.url ?? s.uri ?? "",
    createdAt: s.created_at,
    visibility: s.visibility,
    inReplyToId: s.in_reply_to_id,
  };
}

/** One POST /api/v1/statuses with the idempotency key. */
async function createStatus(server: string, token: string, body: Record<string, string>, idempotencyKey: string, action: Action, post: Post, now: () => Date): Promise<{ id: string; link: string | null }> {
  const url = new URL("/api/v1/statuses", server);
  const res = await post(url, {
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "idempotency-key": idempotencyKey },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(MASTODON_TIMEOUT_MS),
  });
  await check(res, action, now);
  // Not JSON throws here on purpose: the status may have been made, so the outcome stays unknown.
  const status = CreatedStatus.safeParse(await res.json());
  if (!status.success) throw new Error("Mastodon answered without a status id");
  return { id: status.data.id, link: status.data.url };
}

/** How each call names itself in a wait or a refusal. */
type Action = { wait: string; refused: string };
const ACTIONS = {
  post: { wait: "posting", refused: "the post" },
  reply: { wait: "replying", refused: "the reply" },
  read: { wait: "reading mentions", refused: "reading mentions" },
} satisfies Record<string, Action>;

/** 429 waits, other 4xx refuse; a redirect or 5xx is not known. Returns only for 2xx. */
async function check(res: HttpAnswer, action: Action, now: () => Date): Promise<void> {
  if (res.status === 429) {
    const reset = Date.parse(res.headers.get("x-ratelimit-reset") ?? "");
    const wait = Number.isFinite(reset) ? Math.max(1, Math.ceil((reset - now().getTime()) / 1000)) : 60;
    throw new MastodonError(`Mastodon asked to wait before ${action.wait} again.`, 429, wait);
  }
  if (res.status >= 400 && res.status < 500) throw new MastodonError(await refusalText(res, action.refused), res.status);
  if (!res.ok) {
    await res.body?.cancel();
    throw new Error(`Mastodon answered ${res.status}`);
  }
}

/** Mastodon's own error text when it gives one, kept short; never the token. */
async function refusalText(res: HttpAnswer, what: string): Promise<string> {
  const body = ErrorAnswer.parse(await res.json().catch(() => null));
  const said = body.error?.slice(0, 200) ?? `status ${res.status}`;
  if (res.status === 401 || res.status === 403) return `Mastodon refused this account's sign-in (${said}). Connect the account again.`;
  return `Mastodon refused ${what}: ${said}`;
}
