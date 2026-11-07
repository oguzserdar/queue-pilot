/**
 * @fileoverview Who sees what, decided per request:
 *
 * - Signed in with Buffer: the app, everywhere.
 * - Not signed in: the homepage at `/` (served from /home, so the address stays `/`), and every app screen sends the
 *   visitor back to `/`.
 * - "Try the demo" (`/demo`): marks the visit as a demo and opens the app's home. The demo is the app itself, the same
 *   screens and code, showing sample data because there is no account. `/demo/leave` ends it. Someone signed in is
 *   sent to their own app instead, so demo buttons can never act on a real account.
 *
 * Only the presence of a session cookie is checked here. That is a routing choice, not authorization: every app page
 * and action still reads the real session itself.
 */
import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

/** The cookie that marks a visit as a demo. */
export const DEMO_COOKIE = "qp_demo";
/** How long a demo visit lasts without coming back. */
const DEMO_DAYS = 7;
/** The app's screens besides `/`: only for someone signed in or in the demo. */
export const APP_SCREENS = ["/connect", "/delivery", "/ideas", "/playbook", "/reviews", "/settings", "/sources", "/voice", "/week"];

const to = (request: NextRequest, path: string) => NextResponse.redirect(new URL(path, request.url));

/**
 * Routes one request for `/`, the homepage's own path, the demo paths or an app screen.
 *
 * @param request - The incoming request
 * @returns A rewrite to the homepage, a redirect, or the request unchanged
 */
export function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const signedIn = !!getSessionCookie(request);
  const demo = request.cookies.get(DEMO_COOKIE)?.value === "1";

  if (path === "/home") return to(request, "/");
  if (path === "/demo") {
    const res = to(request, "/");
    if (!signedIn) res.cookies.set(DEMO_COOKIE, "1", { path: "/", httpOnly: true, sameSite: "lax", secure: request.nextUrl.protocol === "https:", maxAge: DEMO_DAYS * 86_400 });
    return res;
  }
  if (path === "/demo/leave") {
    const res = to(request, "/");
    res.cookies.delete(DEMO_COOKIE);
    return res;
  }
  if (signedIn || demo) return NextResponse.next();
  if (path !== "/") return to(request, "/");
  // The homepage keeps its query string, so a campaign link like /?ref=launch reaches the page with it.
  const home = request.nextUrl.clone();
  home.pathname = "/home";
  return NextResponse.rewrite(home);
}

// Next.js reads the matcher at build time, so it is written out: the paths above and each of APP_SCREENS.
export const config = {
  matcher: [
    "/", "/home", "/demo", "/demo/leave",
    "/connect/:path*", "/delivery/:path*", "/ideas/:path*", "/playbook/:path*", "/reviews/:path*",
    "/settings/:path*", "/sources/:path*", "/voice/:path*", "/week/:path*",
  ],
};
