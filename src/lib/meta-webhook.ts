/**
 * Meta webhooks for Instagram, read only from Meta's documentation (developers.facebook.com, read 15 Nov 2026):
 * - instagram-platform/webhooks/setup.md: every payload is signed with the app's App Secret, SHA256, in
 *   `X-Hub-Signature-256: sha256=<hex>`; the one-time verification is a GET with hub.mode=subscribe, hub.challenge and
 *   hub.verify_token, answered with the challenge. Comment notifications need Advanced Access and a Live app.
 * - business-messaging/messenger-platform/webhooks.md: the signature is over the payload as sent, "an escaped unicode
 *   version of the payload, with lowercase hex digits", so it is checked on the raw body text, never on JSON parsed and
 *   written again; answer 200 within 5 seconds.
 * - instagram-platform/webhooks/examples.md: a comment arrives as entry[].field "comments" with value {id, from{id,
 *   username}, text, media{id}}; production handlers also receive the same value inside entry[].changes[], several
 *   to an entry, so both shapes are read; a message as entry[].messaging[] with message{mid, text, is_echo}, where is_echo means
 *   the account itself sent it.
 *
 * Nothing here touches the database: the route checks, parses, and hands over plain events.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

/** One comment or direct message for a connected Instagram account. The account's own messages are never included. */
export type InstagramEvent = {
  /** The connected account's Instagram id (entry[].id). */
  accountId: string;
  kind: "comment" | "dm";
  /** The comment id, or the message id (mid). */
  externalId: string;
  from: { id: string; username: string | null };
  text: string;
  /** The post a comment is on. */
  postId: string | null;
  at: Date;
};

/**
 * True when the header is Meta's signature of this exact body under this secret. Compared in constant time.
 *
 * @param raw - The request body exactly as received (request.text()), never re-serialized
 * @param header - The X-Hub-Signature-256 header, "sha256=<hex>"
 * @param secret - The app secret; an empty one never matches
 */
export function signatureValid(raw: string, header: string | null, secret: string): boolean {
  if (!secret || !header?.startsWith("sha256=")) return false;
  const got = Buffer.from(header.slice(7), "hex");
  const want = createHmac("sha256", secret).update(raw, "utf8").digest();
  return got.length === want.length && timingSafeEqual(got, want);
}

/**
 * The challenge to answer Meta's one-time verification with, or null to refuse it.
 *
 * @param query - The GET request's query
 * @param token - This server's verify token; an empty one never matches
 */
export function challengeFor(query: URLSearchParams, token: string): string | null {
  const sent = query.get("hub.verify_token") ?? "";
  const challenge = query.get("hub.challenge");
  if (!token || query.get("hub.mode") !== "subscribe" || !challenge) return null;
  const a = Buffer.from(sent);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b) ? challenge : null;
}

const str = (v: unknown) => (typeof v === "string" ? v : null);
/** Whether a JSON value is an object whose fields can be read (an array counts, as it did; its fields read as missing). */
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const rec = (v: unknown) => (isRecord(v) ? v : null);

/** A comment arrives either as field/value on the entry or as one or more items in entry.changes. */
function changesOf(entry: Record<string, unknown>): unknown[] {
  if (entry.field === "comments") return [{ field: entry.field, value: entry.value }];
  return Array.isArray(entry.changes) ? entry.changes : [];
}

/** The comments on one entry, leaving out the account's own. */
function commentEvents(entry: Record<string, unknown>, accountId: string): InstagramEvent[] {
  const out: InstagramEvent[] = [];
  for (const c of changesOf(entry)) {
    const change = rec(c);
    if (change?.field !== "comments") continue;
    const v = rec(change.value);
    const from = rec(v?.from);
    const id = str(v?.id);
    const fromId = str(from?.id);
    if (!id || !fromId || fromId === accountId) continue;
    out.push({ accountId, kind: "comment", externalId: id, from: { id: fromId, username: str(from?.username) }, text: str(v?.text) ?? "", postId: str(rec(v?.media)?.id), at: new Date(Number(entry.time) * 1000) });
  }
  return out;
}

/** The direct messages on one entry, leaving out echoes of the account's own messages. */
function messageEvents(entry: Record<string, unknown>, accountId: string): InstagramEvent[] {
  if (!Array.isArray(entry.messaging)) return [];
  const out: InstagramEvent[] = [];
  for (const m of entry.messaging) {
    const e = rec(m);
    const msg = rec(e?.message);
    const fromId = str(rec(e?.sender)?.id);
    const mid = str(msg?.mid);
    if (!msg || !mid || !fromId || msg.is_echo === true || fromId === accountId) continue;
    out.push({ accountId, kind: "dm", externalId: mid, from: { id: fromId, username: null }, text: str(msg.text) ?? "", postId: null, at: new Date(Number(e?.timestamp)) });
  }
  return out;
}

/**
 * The comments and direct messages in one webhook body. Anything else (other fields, other objects, the account's own
 * comments and echoes of its own messages) is left out; a body it cannot read gives no events.
 */
export function parseInstagramEvents(body: unknown): InstagramEvent[] {
  const batches = Array.isArray(body) ? body : [body];
  const out: InstagramEvent[] = [];
  for (const batch of batches) {
    const b = rec(batch);
    if (b?.object !== "instagram" || !Array.isArray(b.entry)) continue;
    for (const raw of b.entry) {
      const entry = rec(raw);
      const accountId = str(entry?.id);
      if (!entry || !accountId) continue;
      out.push(...commentEvents(entry, accountId), ...messageEvents(entry, accountId));
    }
  }
  return out;
}
