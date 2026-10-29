import { DeliveryView } from "@/components/delivery-view";
import { getCurrentUser, signedInUserId } from "@/lib/current-user";
import { postgresEchoStore } from "@/lib/echo-store";
import { MAX_ATTEMPTS } from "@/lib/echo";
import type { CopyMarks } from "@/components/delivery-view";
import { deliveriesFromBuffer } from "@/lib/delivery-model";
import { deliveries as demoDeliveries, deliveryCopies } from "@/lib/demo-data";
import { postsBetween } from "@/lib/posts-between";

export default async function Page() {
  const { user } = await getCurrentUser();
  if (!user) return <DeliveryView deliveries={demoDeliveries} copies={deliveryCopies} />;
  const now = new Date();
  const range = { start: new Date(now.getTime() - 7 * 86_400_000), end: now };
  const posts = postsBetween(user.posts, range.start, range.end);
  return <DeliveryView deliveries={deliveriesFromBuffer(user.channels, posts, range, now)} copies={await copyMarks(posts.map((p) => p.id))} />;
}

/** Which sent posts were copied to Telegram or Discord, for the marks beside each row. Empty when nothing is connected. */
async function copyMarks(postIds: string[]): Promise<CopyMarks> {
  const userId = await signedInUserId();
  if (!userId || postIds.length === 0) return {};
  const store = postgresEchoStore();
  const [destinations, records] = await Promise.all([store.destinations(userId), store.records(userId, postIds)]);
  const kindOf = new Map(destinations.map((d) => [d.id, d.kind]));
  const marks: CopyMarks = {};
  for (const r of records) {
    const kind = kindOf.get(r.destinationId);
    // A failed copy that will be retried is not shown yet; only the final outcome is.
    if (!kind || (r.status === "failed" && r.attempts < MAX_ATTEMPTS)) continue;
    (marks[r.postId] ??= []).push({ kind, ok: r.status === "sent" });
  }
  return marks;
}
