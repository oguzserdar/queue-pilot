/**
 * Where OpenRouter sends the person back. The state and the signed-in user must match the cookie set at the start;
 * the code is then exchanged for their key, which is checked by listing its models and stored encrypted like a
 * pasted key.
 */
import { NextResponse, type NextRequest } from "next/server";
import { postgresAiKeyStore } from "@/lib/ai-key-store";
import { listModels, ModelListError } from "@/lib/ai-models";
import { signedInUserId } from "@/lib/current-user";
import { publicOrigin } from "@/lib/origin";
import { limit } from "@/lib/rate-limit";
import { COOKIE, exchangeCode, OpenRouterConnectError, verifierFor } from "@/lib/openrouter-connect";

export async function GET(req: NextRequest) {
  const back = (result: string) => {
    const res = NextResponse.redirect(`${publicOrigin(req.headers)}/settings?openrouter=${result}`, 303);
    res.cookies.delete({ name: COOKIE, path: "/api/openrouter" });
    return res;
  };
  const master = process.env.SETTINGS_KEY;
  if (!master) return back("not-set-up");
  const userId = await signedInUserId();
  if (!userId) return back("signed-out");
  if (!(await limit("connect", userId)).ok) return back("slow");
  const code = req.nextUrl.searchParams.get("code");
  const verifier = verifierFor(req.cookies.get(COOKIE)?.value, req.nextUrl.searchParams.get("state"), userId);
  if (!code || !verifier) return back("expired");
  try {
    const key = await exchangeCode(code, verifier);
    const list = await listModels("openrouter", key);
    if (!list.recommended) return back("no-models");
    await postgresAiKeyStore(master).set(userId, "openrouter", key, list.recommended);
    return back("connected");
  } catch (e) {
    if (!(e instanceof OpenRouterConnectError || e instanceof ModelListError))
      console.error(JSON.stringify({ event: "qp-openrouter-connect-failed", message: e instanceof Error ? e.message : String(e) }));
    return back("failed");
  }
}
