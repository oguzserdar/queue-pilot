/**
 * Signed session cookie holding only the Buffer account id. Tokens never go to the browser; they live in the token store.
 * Signature: HMAC-SHA256 over the value with SESSION_SECRET, compared in constant time.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

const sign = (value: string, secret: string) => createHmac("sha256", secret).update(value).digest("base64url");

/** "accountId.signature" */
export function sealSession(accountId: string, secret: string): string {
  return `${accountId}.${sign(accountId, secret)}`;
}

/** The account id if the cookie is intact, otherwise null. */
export function openSession(cookie: string | undefined, secret: string): string | null {
  if (!cookie) return null;
  const dot = cookie.lastIndexOf(".");
  if (dot <= 0) return null;
  const value = cookie.slice(0, dot);
  const given = Buffer.from(cookie.slice(dot + 1));
  const expected = Buffer.from(sign(value, secret));
  return given.length === expected.length && timingSafeEqual(given, expected) ? value : null;
}
