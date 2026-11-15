/**
 * Starts "Connect Mastodon" from the form in Settings: registers Queue Pilot on the person's instance if needed, keeps
 * the sign-in state in a short-lived sealed cookie for the callback only, and sends the person to their instance.
 */
import { NextResponse, type NextRequest } from "next/server";
import { signedInUserId } from "@/lib/current-user";
import { publicOrigin } from "@/lib/origin";
import { limit } from "@/lib/rate-limit";
import { ConnectError, MASTODON_COOKIE, MASTODON_COOKIE_MAX_AGE_S, startMastodonConnect } from "@/lib/social-connect";

export async function POST(req: NextRequest) {
  const origin = publicOrigin(req.headers);
  const back = (result: string) => NextResponse.redirect(`${origin}/settings?mastodon=${result}`, 303);
  const master = process.env.SETTINGS_KEY;
  if (!master) return back("not-set-up");
  const userId = await signedInUserId();
  if (!userId) return back("signed-out");
  if (!(await limit("connect", userId)).ok) return back("slow");
  const field = (await req.formData().catch(() => null))?.get("instance");
  const instance = typeof field === "string" ? field : "";
  try {
    const { url, cookie } = await startMastodonConnect(userId, instance, `${origin}/api/mastodon/callback`, { master });
    const res = NextResponse.redirect(url, 303);
    res.cookies.set(MASTODON_COOKIE, cookie, { httpOnly: true, secure: true, sameSite: "lax", path: "/api/mastodon", maxAge: MASTODON_COOKIE_MAX_AGE_S });
    return res;
  } catch (e) {
    if (e instanceof ConnectError) return back(e.code);
    console.error(JSON.stringify({ event: "qp-mastodon-start-failed", message: e instanceof Error ? e.message : String(e) }));
    return back("failed");
  }
}
