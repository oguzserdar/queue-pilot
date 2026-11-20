/**
 * Where the person's Mastodon instance sends them back. The sealed cookie, the signed-in person and the state must all
 * match before the code is exchanged; the token is stored encrypted and never appears in an address.
 */
import { NextResponse, type NextRequest } from "next/server";
import { signedInUserId } from "@/lib/current-user";
import { publicOrigin } from "@/lib/origin";
import { limit } from "@/lib/rate-limit";
import { ConnectError, finishMastodonConnect, MASTODON_COOKIE } from "@/lib/social-connect";

export async function GET(req: NextRequest) {
  const origin = publicOrigin(req.headers);
  const back = (result: string) => {
    const res = NextResponse.redirect(`${origin}/settings?mastodon=${result}`, 303);
    res.cookies.delete({ name: MASTODON_COOKIE, path: "/api/mastodon" });
    return res;
  };
  const master = process.env.SETTINGS_KEY;
  if (!master) return back("not-set-up");
  const userId = await signedInUserId();
  if (!userId) return back("signed-out");
  if (!(await limit("connect", userId)).ok) return back("slow");
  const q = req.nextUrl.searchParams;
  try {
    await finishMastodonConnect({ userId, cookie: req.cookies.get(MASTODON_COOKIE)?.value, state: q.get("state"), code: q.get("code"), redirectUri: `${origin}/api/mastodon/callback` }, { master });
    return back("connected");
  } catch (e) {
    if (e instanceof ConnectError) return back(e.code);
    console.error(JSON.stringify({ event: "qp-mastodon-callback-failed", message: e instanceof Error ? e.message : String(e) }));
    return back("failed");
  }
}
