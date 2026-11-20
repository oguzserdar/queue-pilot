/**
 * Answers new Mastodon and Bluesky mentions for accounts whose owner turned replies on (src/lib/reply-run.ts). The
 * Docker cron service calls it in the background every 30 seconds; each account is read no more often than its
 * network allows, so most calls read nothing. Called with "Authorization: Bearer <CRON_SECRET>"; anything else gets 401.
 */
import { cronAuthorized } from "@/lib/cron-auth";
import { runDueReplies } from "@/lib/reply-run";

export const maxDuration = 60;

export async function GET(req: Request) {
  if (!cronAuthorized(req.headers.get("authorization"), process.env.CRON_SECRET)) return new Response(null, { status: 401 });
  return Response.json(await runDueReplies());
}
