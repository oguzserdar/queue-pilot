/**
 * @fileoverview Clears Better Auth's sign-in cookies from a response or the request's cookie jar.
 *
 * The router only checks that a sign-in cookie exists, so wherever a session is known to be gone (account deleted,
 * session expired, sign-in switched off) the cookies are cleared here, in one place, so their name and attributes
 * never drift between callers.
 */

type CookieWriter = { set(name: string, value: string, options: { path: string; maxAge: number; httpOnly: boolean; sameSite: "lax"; secure: boolean }): unknown };

/** Better Auth's cookie names, with or without the secure-host prefix. */
const SIGN_IN_COOKIE = /^(__Secure-)?better-auth\./;

/**
 * Expires every sign-in cookie among `present`.
 *
 * @param present - The cookies the browser sent
 * @param out - Where to write the expired cookies: a NextResponse's cookies or the cookies() jar
 * @returns How many cookies were cleared
 */
export function clearSignInCookies(present: { name: string }[], out: CookieWriter): number {
  let n = 0;
  for (const { name } of present) {
    if (!SIGN_IN_COOKIE.test(name)) continue;
    out.set(name, "", { path: "/", maxAge: 0, httpOnly: true, sameSite: "lax", secure: name.startsWith("__Secure-") });
    n++;
  }
  return n;
}
