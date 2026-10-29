/** "Download my data": the signed-in person's export as a JSON file (src/lib/export-data.ts). */
import { signedInUserId } from "@/lib/current-user";
import { exportUserData } from "@/lib/export-data";
import { limit, limitHeaders } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const userId = await signedInUserId();
  if (!userId) return Response.json({ error: "Sign in with Buffer to download your data." }, { status: 401 });
  const l = await limit("account", userId);
  if (!l.ok) return Response.json({ error: `Too many downloads just now. Try again in ${l.resetSeconds} seconds.` }, { status: 429, headers: limitHeaders("account", l) });
  const data = await exportUserData(userId);
  if (!data) return Response.json({ error: "This account no longer exists." }, { status: 404 });
  const day = data.exportedAt.slice(0, 10);
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="queue-pilot-data-${day}.json"`,
      "cache-control": "no-store",
      ...limitHeaders("account", l),
    },
  });
}
