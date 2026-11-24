"use server";
/**
 * The Accept button on the claim page. The person comes from the Better Auth session read here on the server, never
 * from the form; the token is bound into the action by the page. Whatever happens, the person lands back on the
 * claim page, which reads the new state and says what happened.
 */
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth } from "@/lib/auth";
import { acceptClaim } from "@/lib/agent-signup/claim";
import { parseClaimToken } from "@/lib/agent-signup/claim-link";
import { agentServer } from "@/lib/agent-signup/server";

/** Accepts the claim named by `token` for the signed-in person. */
export async function acceptClaimAction(token: string): Promise<void> {
  if (!parseClaimToken(token)) redirect("/claim/unknown");
  const auth = await getAuth();
  const server = await agentServer();
  const session = auth ? await auth.api.getSession({ headers: await headers() }) : null;
  if (server && session) {
    const result = await acceptClaim(server, token, session.user.id);
    console.log(JSON.stringify({ event: "qp-agent-claim", ok: result.ok, reason: result.ok ? null : result.reason }));
  }
  redirect(`/claim/${token}`);
}
