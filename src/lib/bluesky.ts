import "server-only";
/**
 * Posts text to a person's own Bluesky account through their PDS: sign in with an app password
 * (com.atproto.server.createSession), then write one app.bsky.feed.post record (com.atproto.repo.createRecord) under a
 * record key we choose, so a retry targets the same record. Also reads the mentions, replies and quotes sent to the
 * account (app.bsky.notification.listNotifications) and answers one with a reply post. Every call goes through the
 * private-network guard: the server address is the person's, so it is https only and never redirected.
 *
 * Sources: bluesky-social/atproto at commit 7dd086d4de20d22777a64043ee29f4afa9a5811b (read 14 Nov 2026)
 * - lexicons/com/atproto/server/createSession.json: input { identifier, password }; output requires accessJwt, did
 * - lexicons/com/atproto/repo/createRecord.json: input { repo, collection, rkey?, record } where the record "must contain
 *   a $type field"; output requires { uri, cid }
 * - packages/pds/lexicons/app/bsky/feed/post.json: key "tid"; record requires text (max 300 graphemes) and createdAt;
 *   optional `reply` is #replyRef { root, parent }, both required, each a com.atproto.repo.strongRef
 * - lexicons/com/atproto/repo/strongRef.json: { uri (at-uri), cid (cid) }, both required
 * - packages/bsky/lexicons/app/bsky/notification/listNotifications.json: a query that "Requires auth"; params
 *   reasons[] (matches #notification.reason), limit 1..100 default 50, cursor; output { cursor?, notifications[] };
 *   each notification requires uri, cid, author (actor.defs#profileView), reason (known values include mention, reply,
 *   quote), record (unknown: the mentioning post itself), isRead, indexedAt
 * - packages/bsky/lexicons/app/bsky/actor/defs.json: profileView requires did and handle
 * - packages/xrpc/src/util.ts (constructMethodCallUrl): an array param is sent as the same key repeated
 * - packages/pds/src/pipethrough.ts (computeProxyTo, defaultService): the PDS forwards app.bsky.* queries it does not
 *   serve itself to the configured AppView, so the read goes to the person's own PDS like the writes
 * - packages/bsky/src/api/app/bsky/notification/listNotifications.ts and
 *   packages/bsky/src/data-plane/server/db/pagination.ts: newest first (keyset paginate defaults to desc), and the
 *   cursor walks toward OLDER notifications; reasons are filtered after the fetch. packages/bsky/src/api/util.ts
 *   (fillPage) refetches only while the page holds under half the limit, up to a request cap, so a short page with a
 *   cursor is normal
 * - packages/syntax/src/tid.ts: 13 chars, /^[234567abcdefghij][234567abcdefghijklmnopqrstuvwxyz]{12}$/
 * - packages/common-web/src/util.ts: the sortable base32 alphabet "234567abcdefghijklmnopqrstuvwxyz"
 * - packages/xrpc/src/types.ts: 400 InvalidRequest, 401 AuthenticationRequired, 429 RateLimitExceeded
 * - packages/xrpc-server/src/errors.ts: error bodies are { error, message }; a 500 never carries details
 * - packages/xrpc-server/src/rate-limiter-http.ts: on a limit, Retry-After (seconds) and RateLimit-Reset (unix seconds)
 * - packages/pds/src/api/com/atproto/repo/createRecord.ts and packages/repo/src/mst/mst.ts: a create on a record key
 *   that already holds a record throws a plain Error ("There is already a value at key"), which answers 500. So a retry
 *   after a post that did land comes back as "not known", never as a refusal.
 */
import { createHash } from "node:crypto";
import * as z from "zod";
import { safeGet, safePost, type HttpAnswer } from "./safe-fetch";

/** Bluesky answered and refused, so nothing was posted. A rate limit carries how long to wait. */
export class BlueskyError extends Error {
  /** @param reason - The server's own words for a refusal (its `message`, else its `error` name), when it gave any */
  /** @param errorName - The XRPC error name when the server gave one, e.g. ExpiredToken (xrpc-server errors.ts) */
  constructor(message: string, readonly status: number, readonly retryAfterSeconds?: number, readonly reason?: string, readonly errorName?: string) {
    super(message);
  }
}

/** How a POST reaches the server; the guarded one in production, a fake in tests. */
export type Post = (url: URL, init: { headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<HttpAnswer>;

/** How an authenticated GET reaches the server; the guarded one (no redirects) in production, a fake in tests. */
export type Get = (url: URL, init: { headers: Record<string, string>; signal?: AbortSignal }) => Promise<HttpAnswer>;

/** A record's address and content hash (com.atproto.repo.strongRef). */
export type StrongRef = { uri: string; cid: string };

/** One mention, reply or quote of the account, as the reply engine reads it. */
export type BlueskyMention = {
  /** The post that mentions the account; with cid, the parent of a reply */
  uri: string;
  cid: string;
  authorDid: string;
  handle: string;
  /** The post's text; empty when the record carries none */
  text: string;
  reason: "mention" | "reply" | "quote";
  indexedAt: string;
  /** The thread's root when the post is itself a reply; absent means the post starts its thread and is the root */
  root?: StrongRef;
  /** The post this one answers directly, when it is a reply (the root, or a reply inside the thread) */
  parent?: StrongRef;
};

/** The reasons the reply engine answers. */
export const MENTION_REASONS = ["mention", "reply", "quote"] as const;

/** Notifications on one page (the lexicon allows up to 100). */
export const MENTIONS_PAGE_LIMIT = 50;

// What each answer must hold, checked instead of trusted (lexicons in bluesky-social/atproto lexicons/).
const SessionAnswer = z.object({ did: z.string(), accessJwt: z.string(), refreshJwt: z.string() });
const SignInAnswer = z.object({ did: z.string(), accessJwt: z.string(), refreshJwt: z.string().optional().catch(undefined), handle: z.string().nullable().catch(null).default(null), didDoc: z.unknown().optional() });
const RecordAnswer = z.object({ uri: z.string() });
const NotificationsAnswer = z.object({ notifications: z.array(z.unknown()), cursor: z.string().optional().catch(undefined) });
const StrongRefShape = z.object({ uri: z.string(), cid: z.string() });
/** The post record is `unknown` in the lexicon: a missing or odd field reads as no text and no thread. */
const MentionRecord = z.object({
  text: z.string().catch(""),
  reply: z.object({ root: StrongRefShape.optional().catch(undefined), parent: StrongRefShape.optional().catch(undefined) }).optional().catch(undefined),
}).catch({ text: "" });
const Notification = z.object({
  uri: z.string(),
  cid: z.string(),
  reason: z.enum(MENTION_REASONS),
  indexedAt: z.string().catch(""),
  author: z.object({ did: z.string(), handle: z.string() }),
  record: MentionRecord,
});
const ErrorAnswer = z.object({ error: z.string().optional().catch(undefined), message: z.string().optional().catch(undefined) }).catch({});

/** The answer's JSON, or null when it is not JSON. */
const readJson = (res: HttpAnswer): Promise<unknown> => res.json().catch(() => null);

/** A signed-in account: the DID is the repo, the access token signs the write. */
/** A signed-in session. The refresh token renews it (com.atproto.server.refreshSession) without signing in again. */
export type BlueskySession = { did: string; accessJwt: string; refreshJwt?: string };

/** The longest one call may take before it counts as no answer. */
export const BLUESKY_TIMEOUT_MS = 20_000;

/** The record type and collection for a post (app.bsky.feed.post). */
export const POST_COLLECTION = "app.bsky.feed.post";

const S32 = "234567abcdefghijklmnopqrstuvwxyz";

/**
 * Signs in with an app password and returns the account's DID and access token.
 *
 * @param server - The PDS's https origin, e.g. https://bsky.social
 * @param identifier - The handle (or other identifier the server accepts)
 * @param appPassword - An app password, never the account password
 * @returns The DID and access token
 * @throws BlueskyError when the server refuses (4xx); a bad password says to connect again
 */
export async function createSession(server: string, identifier: string, appPassword: string, post: Post = safePost, now: () => Date = () => new Date()): Promise<BlueskySession> {
  const { did, accessJwt, refreshJwt } = await signIn(server, identifier, appPassword, post, now);
  return refreshJwt ? { did, accessJwt, refreshJwt } : { did, accessJwt };
}

/**
 * Renews a session with its refresh token, so a server that counts sign-ins (the PDS allows 30 per 5 minutes and 300
 * a day: packages/pds/src/api/com/atproto/server/createSession.ts) is not asked to sign in again. The lexicon
 * (lexicons/com/atproto/server/refreshSession.json) requires the refreshJwt, not the accessJwt, and answers a new pair.
 *
 * @throws BlueskyError when the refresh token is refused (expired or revoked); sign in again then
 */
export async function refreshSession(server: string, refreshJwt: string, post: Post = safePost, now: () => Date = () => new Date()): Promise<BlueskySession> {
  const res = await call(server, "com.atproto.server.refreshSession", {}, { authorization: `Bearer ${refreshJwt}` }, post, now);
  const body = SessionAnswer.safeParse(await readJson(res));
  if (!body.success) throw new Error("Bluesky answered without a session");
  return body.data;
}

/**
 * True when a call was refused only because the access token expired: a 400 named ExpiredToken
 * (packages/pds/src/auth-verifier.ts, jose JWTExpired). Nothing was written, so it is safe to refresh and call again.
 */
export function isExpiredToken(e: unknown): boolean {
  return e instanceof BlueskyError && e.status === 400 && e.errorName === "ExpiredToken";
}

/** A new sign-in with what connecting an account needs besides the session: the handle and the DID document. */
export type BlueskySignIn = BlueskySession & { handle: string | null; didDoc: unknown };

/**
 * Signs in like createSession and also returns the account's handle and DID document (both in the lexicon's output;
 * the document is optional there), so connecting can name the account and find the server it lives on.
 *
 * @throws BlueskyError when the server refuses (4xx), carrying the server's own reason
 */
export async function signIn(server: string, identifier: string, appPassword: string, post: Post = safePost, now: () => Date = () => new Date()): Promise<BlueskySignIn> {
  const res = await call(server, "com.atproto.server.createSession", { identifier, password: appPassword }, {}, post, now);
  const body = SignInAnswer.safeParse(await readJson(res));
  if (!body.success) throw new Error("Bluesky answered without a session");
  const { refreshJwt, didDoc, ...rest } = body.data;
  return { ...rest, didDoc, ...(refreshJwt === undefined ? {} : { refreshJwt }) };
}

/**
 * Posts the exact text as a new post under the given record key. The same key on a retry targets the same record, so a
 * post that already landed cannot be posted twice; the server answers that retry with a 500.
 *
 * @param server - The PDS's https origin
 * @param session - From createSession
 * @param text - The post text, sent as is
 * @param rkey - A TID, stable for this destination of this post (see tidFor)
 * @returns The record's at:// URI and its bsky.app link
 * @throws BlueskyError when the server refuses (4xx); any other failure means it may or may not have landed
 */
export async function postText(server: string, session: BlueskySession, text: string, rkey: string, post: Post = safePost, now: () => Date = () => new Date()): Promise<{ uri: string; link: string }> {
  return createPost(server, session, { $type: POST_COLLECTION, text, createdAt: now().toISOString() }, rkey, post, now);
}

/** One app.bsky.feed.post record written under the given key. */
async function createPost(server: string, session: BlueskySession, record: Record<string, unknown>, rkey: string, post: Post, now: () => Date): Promise<{ uri: string; link: string }> {
  const res = await call(server, "com.atproto.repo.createRecord", { repo: session.did, collection: POST_COLLECTION, rkey, record }, { authorization: `Bearer ${session.accessJwt}` }, post, now);
  const body = RecordAnswer.safeParse(await readJson(res));
  if (!body.success) throw new Error("Bluesky answered without a record uri");
  return { uri: body.data.uri, link: `https://bsky.app/profile/${session.did}/post/${rkey}` };
}

/**
 * Reads the newest mentions, replies and quotes of the account. Notifications come newest first and the cursor walks
 * toward older ones, so a poll starts with no cursor and follows the cursor only until it reaches what it has already
 * seen. A page may hold fewer than the limit while a cursor is still given; only a missing cursor means the end.
 *
 * @param server - The PDS's https origin
 * @param session - From createSession
 * @param cursor - The cursor from the previous page; omit for the newest page
 * @returns The mentions and the cursor for the next (older) page, absent at the end
 * @throws BlueskyError when the server refuses (4xx) or asks to wait (429); any other failure is not known
 */
export async function listMentions(server: string, session: BlueskySession, cursor?: string, get: Get = safeGet, now: () => Date = () => new Date()): Promise<{ mentions: BlueskyMention[]; cursor: string | undefined }> {
  const url = new URL("/xrpc/app.bsky.notification.listNotifications", server);
  for (const reason of MENTION_REASONS) url.searchParams.append("reasons", reason);
  url.searchParams.set("limit", String(MENTIONS_PAGE_LIMIT));
  if (cursor) url.searchParams.set("cursor", cursor);
  const res = await get(url, { headers: { authorization: `Bearer ${session.accessJwt}`, accept: "application/json" }, signal: AbortSignal.timeout(BLUESKY_TIMEOUT_MS) });
  await check(res, "app.bsky.notification.listNotifications", now);
  const body = NotificationsAnswer.safeParse(await readJson(res));
  if (!body.success) throw new Error("Bluesky answered without a list of notifications");
  return { mentions: body.data.notifications.flatMap((n) => toMention(n) ?? []), cursor: body.data.cursor || undefined };
}

/**
 * Replies to one post with the exact text, under the given record key as postText does (see tidFor), so a retry
 * targets the same record.
 *
 * @param server - The PDS's https origin
 * @param session - From createSession
 * @param parent - The post answered: the mention's { uri, cid }
 * @param root - The thread's root: the mention's root, or the mention itself when it has none
 * @param text - The reply text, sent as is
 * @param rkey - A TID, stable for this reply (see tidFor)
 * @returns The reply's at:// URI and its bsky.app link
 * @throws BlueskyError when the server refuses (4xx); any other failure means it may or may not have landed
 */
export async function replyTo(server: string, session: BlueskySession, parent: StrongRef, root: StrongRef, text: string, rkey: string, post: Post = safePost, now: () => Date = () => new Date()): Promise<{ uri: string; link: string }> {
  const record = { $type: POST_COLLECTION, text, reply: { root: { uri: root.uri, cid: root.cid }, parent: { uri: parent.uri, cid: parent.cid } }, createdAt: now().toISOString() };
  return createPost(server, session, record, rkey, post, now);
}

/** A notification the reply engine answers, or null when it is not one (another reason, or a field missing). */
function toMention(raw: unknown): BlueskyMention | null {
  const parsed = Notification.safeParse(raw);
  if (!parsed.success) return null;
  const n = parsed.data;
  const root = n.record.reply?.root;
  const parent = n.record.reply?.parent;
  return {
    uri: n.uri,
    cid: n.cid,
    authorDid: n.author.did,
    handle: n.author.handle,
    text: n.record.text,
    reason: n.reason,
    indexedAt: n.indexedAt,
    ...(root ? { root } : {}),
    ...(parent ? { parent } : {}),
  };
}

/**
 * The TID for one destination of one post: the time part is `at` in microseconds since the epoch, the clock-id part
 * comes from the key, so a retry with the same key and time writes to the same record key. Layout as in
 * packages/common-web/src/tid.ts (fromTime): 11 base32-sortable characters of microseconds, then 2 of clock id.
 * That file does not pad the time part; it is padded here with "2" (zero), which only matters before 2005.
 *
 * @param key - Stable per post and account, e.g. `${postId}:${accountId}`
 * @param at - A time that never changes for this destination, e.g. the send row's created time
 * @returns 13 characters matching the TID syntax in packages/syntax/src/tid.ts
 * @throws RangeError for an invalid date, a date before 1970, or one past the TID range (2^53 - 1 microseconds)
 */
export function tidFor(key: string, at: Date): string {
  const micros = at.getTime() * 1000;
  if (!Number.isFinite(micros) || micros < 0 || micros > Number.MAX_SAFE_INTEGER) throw new RangeError("The time is outside what a Bluesky record key can hold");
  const digest = createHash("sha256").update(key).digest();
  const clockId = ((digest[0] << 8) | digest[1]) & 0x3ff;
  // A Date only has milliseconds, so the last three microsecond digits would always be 000. Filling them from the
  // hash too gives about a million distinct keys per millisecond instead of 1,024, while the time still sorts and
  // stays within the same millisecond.
  const subMillis = ((digest[2] << 8) | digest[3]) % 1000;
  if (micros + subMillis > Number.MAX_SAFE_INTEGER) throw new RangeError("The time is outside what a Bluesky record key can hold");
  return s32(micros + subMillis, 11) + s32(clockId, 2);
}

/** A whole number in the base32-sortable alphabet, left-padded with the zero digit to `width`. */
function s32(n: number, width: number): string {
  let s = "";
  for (let rest = n; rest > 0; rest = Math.floor(rest / 32)) s = S32[rest % 32] + s;
  return s.padStart(width, S32[0]);
}

/** One XRPC procedure call; returns the response only when it is 2xx. */
async function call(server: string, method: string, input: unknown, headers: Record<string, string>, post: Post, now: () => Date): Promise<HttpAnswer> {
  const res = await post(new URL(`/xrpc/${method}`, server), {
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(BLUESKY_TIMEOUT_MS),
  });
  await check(res, method, now);
  return res;
}

/** 429 waits, other 4xx refuse; a redirect or 5xx is not known. Returns only for 2xx. */
async function check(res: HttpAnswer, method: string, now: () => Date): Promise<void> {
  const reading = method === "app.bsky.notification.listNotifications";
  if (res.status === 429) throw new BlueskyError(`Bluesky asked to wait before ${reading ? "reading mentions" : "posting"} again.`, 429, waitSeconds(res, now));
  if (res.status >= 400 && res.status < 500) {
    const { text, said, name } = await refusalText(res, method);
    throw new BlueskyError(text, res.status, undefined, said, name);
  }
  if (!res.ok) {
    await res.body?.cancel();
    throw new Error(`Bluesky answered ${res.status}`);
  }
}

/** Retry-After first, then RateLimit-Reset (unix seconds), else 60 s. */
function waitSeconds(res: HttpAnswer, now: () => Date): number {
  const after = Number(res.headers.get("retry-after"));
  if (Number.isFinite(after) && after > 0) return Math.ceil(after);
  const reset = Number(res.headers.get("ratelimit-reset"));
  if (Number.isFinite(reset) && reset > 0) return Math.max(1, Math.ceil(reset - now().getTime() / 1000));
  return 60;
}

/** Bluesky's own error text when it gives one, kept short; never the password or token. */
async function refusalText(res: HttpAnswer, method: string): Promise<{ text: string; said: string; name?: string }> {
  const body = ErrorAnswer.parse(await readJson(res));
  const name = body.error?.slice(0, 100);
  const said = (body.message ?? body.error)?.slice(0, 200) ?? `status ${res.status}`;
  if (res.status === 401 || res.status === 403) return { said, name, text: `Bluesky refused this account's sign-in (${said}). Connect the account again.` };
  if (method === "com.atproto.server.createSession") return { said, name, text: `Bluesky refused the sign-in: ${said}. Connect the account again.` };
  if (method === "app.bsky.notification.listNotifications") return { said, name, text: `Bluesky refused reading mentions: ${said}` };
  return { said, name, text: `Bluesky refused the post: ${said}` };
}
