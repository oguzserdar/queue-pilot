/**
 * @fileoverview Instagram replies over the Instagram API with Instagram Login, from Meta's documentation (read 15-16 Nov
 * 2026: instagram-platform/private-replies, instagram-api-with-instagram-login/messaging-api, messenger-platform/
 * error-codes, graph-api/overview/rate-limiting):
 * - One endpoint, POST graph.instagram.com/<version>/<IG_ID>/messages: a private reply to a comment names the comment
 *   (recipient.comment_id, one message per commenter within 7 days); a reply in a conversation names the person
 *   (recipient.id, inside the 24-hour window). Text is at most 1000 bytes of UTF-8.
 * - No idempotency key exists, so a reply is sent at most once: an answer lost after the call left is never retried.
 * - Refusals fall in three classes: wait (4, 9/2018352, 613, 80002), sign-in gone (190), never (everything else,
 *   including a closed window and a person who cannot receive messages).
 */
import * as z from "zod";
import type { HttpAnswer } from "./safe-fetch";

/** The Graph API version the calls name; the documentation read on 15 Nov 2026 used v27.0. */
export const GRAPH_VERSION = "v27.0";
const HOST = "https://graph.instagram.com";
/** The longest reply text Instagram accepts, in bytes of UTF-8. */
export const TEXT_LIMIT_BYTES = 1000;
const TIMEOUT_MS = 20_000;

type Post = (url: URL, init: { headers: Record<string, string>; body: string; signal: AbortSignal }) => Promise<HttpAnswer>;

/** What a refusal means for the reply: wait and try again, reconnect the account, or never send. */
export type RefusalKind = "wait" | "signIn" | "never";

/** Instagram refused a call. `kind` says what to do; `retryAfterSeconds` is set for a wait. */
export class InstagramError extends Error {
  constructor(message: string, readonly status: number, readonly kind: RefusalKind, readonly code: number | null, readonly retryAfterSeconds?: number) {
    super(message);
  }
}

/** Codes Meta lists for rate limits, each with the subcode it applies to (null: any subcode). */
const WAIT_CODES: [number, number | null][] = [[4, null], [9, 2018352], [613, null], [80002, null]];

/**
 * What a refusal code means.
 *
 * @param code - Meta's error code
 * @param subcode - Meta's error subcode, when given
 * @returns wait for a rate limit, signIn for a refused token, never for anything else
 */
export function refusalKind(code: number | null, subcode: number | null): RefusalKind {
  if (code === 190) return "signIn";
  if (code !== null && WAIT_CODES.some(([c, s]) => c === code && (s === null || s === subcode))) return "wait";
  return "never";
}

const UsageHeader = z.record(z.string(), z.array(z.object({ estimated_time_to_regain_access: z.number().nonnegative() }).loose()));

/**
 * How long a throttled call says to wait, from X-Business-Use-Case-Usage (minutes in Meta's header). A throttle without
 * a usable header still waits a minute: it must never be treated as "send again now".
 */
export function waitSecondsFrom(header: string | null): number {
  let json: unknown = null;
  try { json = header ? JSON.parse(header) : null; } catch { json = null; }
  const usage = UsageHeader.safeParse(json);
  if (!usage.success) return 60;
  const minutes = Math.max(0, ...Object.values(usage.data).flat().map((u) => u.estimated_time_to_regain_access));
  return Math.max(60, minutes * 60);
}

const Sent = z.object({ message_id: z.string().min(1) }).loose();
const Refusal = z.object({ error: z.object({ code: z.number().optional(), error_subcode: z.number().optional(), message: z.string().optional() }).loose() }).loose();

/** The problem with a reply's text, or null when Instagram will take it. */
export function textProblem(text: string): string | null {
  if (!text.trim()) return "The reply is empty.";
  const bytes = new TextEncoder().encode(text).length;
  return bytes > TEXT_LIMIT_BYTES ? `Instagram takes at most ${TEXT_LIMIT_BYTES} bytes; this reply is ${bytes}.` : null;
}

/** What a refusal without Meta's error body means: a 429 is a wait, anything else is not sent again. */
const kindFromStatus = (status: number): RefusalKind => (status === 429 ? "wait" : "never");

/** Who a reply goes to: the comment it answers privately, or the person in the conversation. */
export type ReplyTarget = { commentId: string } | { userId: string };

/**
 * Sends one reply, once. The token goes in the Authorization header, never in the address or an error message.
 *
 * @param igId - The account's Instagram professional account id (the id webhooks carry)
 * @param token - The account's access token
 * @param to - The comment to answer privately, or the person to answer in the conversation
 * @param text - The reply, at most 1000 bytes
 * @returns The id Instagram gave the message
 * @throws InstagramError when Instagram refuses, with what the refusal means
 */
export async function sendReply(igId: string, token: string, to: ReplyTarget, text: string, post: Post): Promise<{ messageId: string }> {
  const recipient = "commentId" in to ? { comment_id: to.commentId } : { id: to.userId };
  const res = await post(new URL(`/${GRAPH_VERSION}/${encodeURIComponent(igId)}/messages`, HOST), {
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ recipient, message: { text } }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const body: unknown = await res.json().catch(() => null);
  const sent = Sent.safeParse(body);
  if (res.ok && sent.success) return { messageId: sent.data.message_id };
  const refusal = Refusal.safeParse(body);
  const code = refusal.success ? (refusal.data.error.code ?? null) : null;
  const subcode = refusal.success ? (refusal.data.error.error_subcode ?? null) : null;
  const kind = refusal.success ? refusalKind(code, subcode) : kindFromStatus(res.status);
  const said = (refusal.success ? refusal.data.error.message : undefined)?.slice(0, 200) ?? `status ${res.status}`;
  const wait = kind === "wait" ? waitSecondsFrom(res.headers.get("x-business-use-case-usage")) : undefined;
  throw new InstagramError(`Instagram refused the reply (${code ?? res.status}${subcode ? `/${subcode}` : ""}): ${said}`, res.status, kind, code, wait);
}
