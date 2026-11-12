import { NextResponse, type NextRequest } from "next/server";
import { getAuth } from "@/lib/auth";
import { clearSignInCookies } from "@/lib/sign-in-cookies";

/**
 * Clears a sign-in cookie whose session no longer exists, then goes to the homepage. The router only checks that a
 * sign-in cookie is present, so after an account is deleted, a session expires or another device signs it out, the
 * leftover cookie would keep showing an empty app. Better Auth's own delete-user clears these cookies the same way.
 * A live session is left alone, so a link to this address cannot sign anyone out. The redirect is relative, as in
 * /auth/signout, so a proxy's internal host is never the target.
 */
export async function GET(req: NextRequest) {
  const res = new NextResponse(null, { status: 303, headers: { location: "/" } });
  const auth = await getAuth();
  // With sign-in switched off no session can be live, so the cookie is cleared. Leaving it would send the visitor
  // back to the app, which sends them here again: a redirect loop.
  if (!auth) { clearSignInCookies(req.cookies.getAll(), res.cookies); return res; }
  // A lookup that fails says nothing about the session, so nothing is cleared: a database hiccup must not sign a
  // live person out. Only a lookup that succeeds and finds no session clears the cookies.
  let live: unknown;
  try {
    live = await auth.api.getSession({ headers: req.headers });
  } catch (e) {
    console.warn(JSON.stringify({ event: "qp-expired-check-failed", message: e instanceof Error ? e.message : String(e) }));
    return res;
  }
  if (live) return res;
  clearSignInCookies(req.cookies.getAll(), res.cookies);
  return res;
}
