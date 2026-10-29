/**
 * The once-a-day echo run (vercel.json crons). Copies sent posts to Telegram and Discord for every user with a
 * destination, so copies do not depend on the user opening Queue Pilot. Vercel calls it with
 * "Authorization: Bearer <CRON_SECRET>"; anything else gets 401. Users run one after another so one account's Buffer
 * read never competes with another's, and the run stops early rather than past the function's time limit.
 */
import { timingSafeEqual } from "node:crypto";
import { getAuth } from "@/lib/auth";
import { postgresSnapshotStore } from "@/lib/buffer/snapshot-store";
import { refreshSnapshot } from "@/lib/buffer/snapshot";
import { bufferAccessToken } from "@/lib/buffer-token";
import { botTokensFromEnv, echoForUser } from "@/lib/echo-run";
import { pruneRequestCounts } from "@/lib/rate-limit";
import { postgresEchoStore } from "@/lib/echo-store";

export const maxDuration = 300;
const BUDGET_MS = 240_000;

function authorized(header: string | null, secret: string | undefined): boolean {
  if (!secret || !header) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(req: Request) {
  if (!authorized(req.headers.get("authorization"), process.env.CRON_SECRET)) return new Response(null, { status: 401 });
  // Request-limit windows older than a day are deleted here, so the counter table stays small.
  await pruneRequestCounts().catch((e) => console.error(JSON.stringify({ event: "qp-prune-request-counts-failed", message: e instanceof Error ? e.message : String(e) })));
  const tokens = botTokensFromEnv();
  const auth = await getAuth();
  if (!auth || (!tokens.telegram && !tokens.discord)) return Response.json({ users: 0, skipped: "not set up" });

  const started = Date.now();
  const store = postgresEchoStore();
  const snapshots = postgresSnapshotStore();
  let users = 0, sent = 0, failed = 0, stoppedEarly = false;
  for (const userId of await store.usersWithDestinations()) {
    if (Date.now() - started > BUDGET_MS) { stoppedEarly = true; break; }
    try {
      const snap = await refreshSnapshot(userId, await bufferAccessToken(auth, userId), { store: snapshots });
      if (!snap) continue;
      const out = await echoForUser(userId, snap.data.posts, { store, tokens });
      users++;
      sent += out.filter((r) => r.status === "sent").length;
      failed += out.filter((r) => r.status === "failed").length;
    } catch (e) {
      console.warn(JSON.stringify({ event: "qp-cron-echo-user-failed", message: e instanceof Error ? e.message : String(e) }));
    }
  }
  console.log(JSON.stringify({ event: "qp-cron-echo", users, sent, failed, stoppedEarly }));
  return Response.json({ users, sent, failed, stoppedEarly });
}
