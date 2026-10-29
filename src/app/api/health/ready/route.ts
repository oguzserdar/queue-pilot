/** Readiness for container hosts and load balancers: 200 when the database answers, 503 when it does not. */
import { dbPool, hasDatabase } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const headers = { "cache-control": "no-store" };
  if (!hasDatabase()) return Response.json({ ok: false, database: "not configured" }, { status: 503, headers });
  try {
    await dbPool().query("select 1");
    return Response.json({ ok: true, database: "ok" }, { headers });
  } catch {
    return Response.json({ ok: false, database: "unreachable" }, { status: 503, headers });
  }
}
