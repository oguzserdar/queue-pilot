import { NextResponse, type NextRequest } from "next/server";
import { getAuth } from "@/lib/auth";

/**
 * Signs out of Queue Pilot on this browser (Better Auth session). POST only, so a link or image cannot sign someone out.
 * The redirect is relative: behind a proxy the request's own origin can be an internal host, which form-action 'self'
 * blocks and which the browser should never be sent to.
 */
export async function POST(req: NextRequest) {
  const res = new NextResponse(null, { status: 303, headers: { location: "/" } });
  const auth = await getAuth();
  if (!auth) return res;
  const out = await auth.api.signOut({ headers: req.headers, asResponse: true });
  for (const cookie of out.headers.getSetCookie()) res.headers.append("set-cookie", cookie);
  return res;
}
