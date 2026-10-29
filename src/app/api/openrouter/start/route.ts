/** Starts "Connect OpenRouter": keeps the PKCE verifier in a short-lived cookie and sends the person to OpenRouter. */
import { NextResponse, type NextRequest } from "next/server";
import { signedInUserId } from "@/lib/current-user";
import { publicOrigin } from "@/lib/origin";
import { limit } from "@/lib/rate-limit";
import { COOKIE, COOKIE_MAX_AGE_S, startConnect } from "@/lib/openrouter-connect";

export async function GET(req: NextRequest) {
  const origin = publicOrigin(req.headers);
  const userId = await signedInUserId();
  if (!userId) return NextResponse.redirect(`${origin}/settings?openrouter=signed-out`, 303);
  if (!(await limit("connect", userId)).ok) return NextResponse.redirect(`${origin}/settings?openrouter=slow`, 303);
  const { url, cookie } = startConnect(userId);
  const res = NextResponse.redirect(url(`${origin}/api/openrouter/callback`), 303);
  res.cookies.set(COOKIE, cookie, { httpOnly: true, secure: true, sameSite: "lax", path: "/api/openrouter", maxAge: COOKIE_MAX_AGE_S });
  return res;
}
