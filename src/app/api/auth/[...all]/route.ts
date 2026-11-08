import { getAuth } from "@/lib/auth";
import { withClientIp } from "@/lib/client-ip";
import { withRetryAfter } from "@/lib/retry-after";

/** Better Auth's endpoints, counted by the resolved client address (src/lib/client-ip.ts). Until the database and Buffer keys exist, every call answers 503 instead of failing inside the library. */
async function handle(req: Request): Promise<Response> {
  const auth = await getAuth();
  if (!auth) return Response.json({ error: "Sign in with Buffer is not open yet" }, { status: 503 });
  return withRetryAfter(await auth.handler(withClientIp(req)));
}

export const GET = handle;
export const POST = handle;
