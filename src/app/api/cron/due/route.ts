/**
 * Sends direct posts whose time has come. The Docker cron service calls it every 30 seconds; it does one indexed
 * query when nothing is due and touches neither Buffer nor the bots. Called with "Authorization: Bearer
 * <CRON_SECRET>"; anything else gets 401.
 */
import { timingSafeEqual } from "node:crypto";
import { runDueDirectPosts } from "@/lib/direct-post-run";

export const maxDuration = 60;

function authorized(header: string | null, secret: string | undefined): boolean {
  if (!secret || !header) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(req: Request) {
  if (!authorized(req.headers.get("authorization"), process.env.CRON_SECRET)) return new Response(null, { status: 401 });
  return Response.json(await runDueDirectPosts());
}
