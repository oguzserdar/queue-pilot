/**
 * Sends direct posts whose time has come. The Docker cron service calls it every 30 seconds; it does one indexed
 * query when nothing is due, and reads the bot tokens only when something is. Called with "Authorization: Bearer
 * <CRON_SECRET>"; anything else gets 401.
 */
import { cronAuthorized } from "@/lib/cron-auth";
import { runDueDirectPosts } from "@/lib/direct-post-run";

export const maxDuration = 60;

export async function GET(req: Request) {
  if (!cronAuthorized(req.headers.get("authorization"), process.env.CRON_SECRET)) return new Response(null, { status: 401 });
  return Response.json(await runDueDirectPosts());
}
