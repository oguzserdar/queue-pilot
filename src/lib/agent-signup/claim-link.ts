/**
 * Claim links and claim codes: the two secrets a person uses to take over an account an agent made
 * (sign-up contract §5 and §7).
 *
 * The link (routes "link" and "email") is never stored.
 *   token = ct_{ticket id}.{key id}.{mac}
 *   mac   = HMAC-SHA256(server secret named by key id, "qp-claim-link/v1" \n route \n ticket id \n registration id)
 * The server rebuilds the link for every reply from the ticket row and checks a presented one by recomputing the mac.
 * Three things follow:
 * - Every reply can carry the same claim_url until the account is deleted, without keeping the secret anywhere.
 * - A copy of the database yields no working link: it holds ticket ids, not macs.
 * - "Used once" is not the mac's job. It comes from used_at on the ticket row, checked inside the accept transaction.
 * The mac covers the route and the registration as well as the ticket id, so a link cannot be replayed against
 * another ticket, another account, or the email route's stricter rules. The fields are joined with newlines, which
 * the id patterns below forbid, so two different inputs can never produce the same message.
 *
 * Rotating the link secret. The new secret signs every link from the moment it is installed, and agents receive the
 * new link in their next reply. The previous secret is still accepted for 34 days after it was retired: the longest
 * a link can live is 72 hours to freeze plus 30 days to deletion, plus a day of margin. After that it is refused
 * here even if the operator forgets to remove it. For a leaked secret, drop `previous` at once: every live link dies,
 * and agents hand out the new ones on their next call.
 *
 * The claim code (route "computer") is what a person types or checks when an agent on their own computer starts a
 * claim (RFC 8628 §3.2 user_code, §5.4 asking the person to confirm the device). 8 characters from 31 letters and
 * digits with 0, 1, I, L and O removed, so it survives being read aloud. It is stored only as an HMAC under a server
 * key, not a plain hash: 31^8 is about 8.5 × 10^11, small enough that a plain SHA-256 copied out of the database
 * could be brute-forced offline in the code's 10-minute life. Five wrong tries kill the ticket (RFC 8628 §5.1 asks
 * for a limit on guesses); the person presses Claim again for a fresh code.
 *
 * Every comparison of a secret uses timingSafeEqual on equal-length buffers, so the time taken does not reveal how
 * much of a guess was right.
 */
import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { REGISTRATION_ID } from "./tokens";

export const LINK_SECRET_FALLBACK_DAYS = 34;
export const CLAIM_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const CLAIM_CODE_LENGTH = 8;
export const MAX_CODE_ATTEMPTS = 5;
/** RFC 8628 §3.2 expires_in and interval for the computer route. */
export const COMPUTER_TICKET_TTL_SECONDS = 600;
export const COMPUTER_POLL_INTERVAL_SECONDS = 5;

const TICKET_ID = /^[A-Za-z0-9_-]{1,64}$/;
const KEY_ID = /^[A-Za-z0-9_-]{1,16}$/;
const MAC = /^[A-Za-z0-9_-]{43}$/; // 32 bytes of HMAC-SHA256, base64url without padding
const MIN_SECRET_LENGTH = 32;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Routes whose ticket is a link. The computer route uses a code; the sign-in route needs neither. */
export type LinkRoute = "link" | "email";
export type LinkTicket = { route: LinkRoute; ticketId: string; registrationId: string };
export type LinkSecret = { id: string; key: string };
export type LinkSecrets = { current: LinkSecret; previous?: LinkSecret & { retiredAt: Date } };

/** Compares two strings in constant time. Unequal lengths return false up front, since timingSafeEqual throws on them. */
function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a, "utf8");
  const y = Buffer.from(b, "utf8");
  return x.length === y.length && timingSafeEqual(x, y);
}

function checkSecret(s: LinkSecret): void {
  if (!KEY_ID.test(s.id)) throw new Error("Claim-link key ids are 1 to 16 characters of A-Z a-z 0-9 _ -");
  if (s.key.length < MIN_SECRET_LENGTH) throw new Error(`Claim-link secrets must be at least ${MIN_SECRET_LENGTH} characters`);
}

function checkTicket(t: LinkTicket): void {
  if (t.route !== "link" && t.route !== "email") throw new Error("Only the link and email routes have claim links");
  if (!TICKET_ID.test(t.ticketId)) throw new Error("Ticket ids are 1 to 64 characters of A-Z a-z 0-9 _ -");
  if (!REGISTRATION_ID.test(t.registrationId)) throw new Error("Not a registration id");
}

function mac(secret: LinkSecret, t: LinkTicket): string {
  return createHmac("sha256", secret.key).update(["qp-claim-link/v1", t.route, t.ticketId, t.registrationId].join("\n")).digest("base64url");
}

/** The token part of a claim link, signed with the current secret. */
export function claimToken(secrets: LinkSecrets, t: LinkTicket): string {
  checkSecret(secrets.current);
  checkTicket(t);
  return `ct_${t.ticketId}.${secrets.current.id}.${mac(secrets.current, t)}`;
}

/** The full claim_url for a reply: {origin}/claim/{token}. */
export function claimUrl(baseURL: string, secrets: LinkSecrets, t: LinkTicket): string {
  return `${new URL(baseURL).origin}/claim/${claimToken(secrets, t)}`;
}

/** Splits a presented token so the caller can load its ticket row. Returns null for anything malformed. */
export function parseClaimToken(token: string): { ticketId: string; keyId: string; mac: string } | null {
  if (!token.startsWith("ct_")) return null;
  const parts = token.slice(3).split(".");
  if (parts.length !== 3) return null;
  const [ticketId, keyId, m] = parts;
  if (!TICKET_ID.test(ticketId) || !KEY_ID.test(keyId) || !MAC.test(m)) return null;
  return { ticketId, keyId, mac: m };
}

/** The secret a token's key id names: the current one, or the previous one inside its fallback window; else null. */
function secretFor(keyId: string, { current, previous }: LinkSecrets, now: Date) {
  if (keyId === current.id) return current;
  if (previous && keyId === previous.id && now.getTime() < previous.retiredAt.getTime() + LINK_SECRET_FALLBACK_DAYS * DAY_MS) return previous;
  return null;
}

/**
 * Checks a presented token against the ticket row it names. True only if the mac matches under the current secret,
 * or under the previous one while it is inside its fallback window. The caller still checks the ticket's state
 * (used, void, deleted account) before accepting.
 */
export function verifyClaimToken(secrets: LinkSecrets, token: string, t: LinkTicket, now: Date): boolean {
  const parsed = parseClaimToken(token);
  if (!parsed || parsed.ticketId !== t.ticketId) return false;
  if (t.route !== "link" && t.route !== "email") return false;
  const secret = secretFor(parsed.keyId, secrets, now);
  if (!secret) return false;
  return safeEqual(mac(secret, t), parsed.mac);
}

/** A fresh code for the computer route, shown as XXXX-XXXX. Each character is drawn without modulo bias. */
export function generateClaimCode(): string {
  let raw = "";
  for (let i = 0; i < CLAIM_CODE_LENGTH; i++) raw += CLAIM_CODE_ALPHABET[randomInt(CLAIM_CODE_ALPHABET.length)];
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}

/** What the person typed, upper-cased with spaces and hyphens removed; null if it cannot be a code. */
export function normalizeClaimCode(input: string): string | null {
  const s = input.toUpperCase().replace(/[\s-]/g, "");
  if (s.length !== CLAIM_CODE_LENGTH) return null;
  for (const ch of s) if (!CLAIM_CODE_ALPHABET.includes(ch)) return null;
  return s;
}

/**
 * The only form of the code that is stored. Rotating `codeKey` invalidates codes already issued; they live at most
 * 10 minutes, and pressing Claim again issues a new one.
 */
export function hashClaimCode(code: string, codeKey: string): string {
  if (codeKey.length < MIN_SECRET_LENGTH) throw new Error(`The claim-code key must be at least ${MIN_SECRET_LENGTH} characters`);
  const normalized = normalizeClaimCode(code);
  if (!normalized) throw new Error("Not a claim code");
  return createHmac("sha256", codeKey).update(`qp-claim-code/v1\n${normalized}`).digest("hex");
}

/** Whether a typed code matches the stored hash. Count the attempt with codeAttempt whatever the answer. */
export function checkClaimCode(input: string, storedHash: string, codeKey: string): boolean {
  const normalized = normalizeClaimCode(input);
  if (!normalized) return false;
  return safeEqual(hashClaimCode(normalized, codeKey), storedHash);
}

/**
 * One try at the code, given the wrong tries so far. The fifth wrong try locks the ticket, and a locked ticket
 * refuses even the right code, so the cap cannot be beaten by guessing after it. The caller stores `attempts` and
 * voids the ticket on "locked", in the same statement that reads it, so two tries at once cannot both count as one.
 */
export function codeAttempt(attemptsSoFar: number, matched: boolean): { outcome: "accepted" | "wrong" | "locked"; attempts: number } {
  if (attemptsSoFar >= MAX_CODE_ATTEMPTS) return { outcome: "locked", attempts: attemptsSoFar };
  if (matched) return { outcome: "accepted", attempts: attemptsSoFar };
  const attempts = attemptsSoFar + 1;
  return { outcome: attempts >= MAX_CODE_ATTEMPTS ? "locked" : "wrong", attempts };
}
