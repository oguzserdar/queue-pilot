/**
 * @fileoverview Picks what `/` shows: the landing page for someone with no session, the app for someone signed in.
 *
 * Only the presence of a session cookie is checked here. That is an optimistic routing choice, not authorization:
 * every app page still reads the real session itself, and the home page sends a visitor whose cookie turned out to
 * be stale to the landing page. The URL stays `/` either way.
 */
import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Serves the landing page at `/` to a visitor without a session cookie.
 *
 * @param request - The incoming request for `/`
 * @returns A rewrite to the landing page, or the app home unchanged
 */
export function proxy(request: NextRequest) {
  if (getSessionCookie(request)) return NextResponse.next();
  return NextResponse.rewrite(new URL("/welcome", request.url));
}

export const config = { matcher: "/" };
