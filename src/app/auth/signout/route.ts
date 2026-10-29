import { NextResponse, type NextRequest } from "next/server";
import { getAuth } from "@/lib/auth";

/** Signs out of Queue Pilot on this browser (Better Auth session). POST only, so a link or image cannot sign someone out. */
export async function POST(req: NextRequest) {
  const res = NextResponse.redirect(new URL("/", req.nextUrl.origin), 303);
  const auth = await getAuth();
  if (!auth) return res;
  const out = await auth.api.signOut({ headers: req.headers, asResponse: true });
  for (const cookie of out.headers.getSetCookie()) res.headers.append("set-cookie", cookie);
  return res;
}
