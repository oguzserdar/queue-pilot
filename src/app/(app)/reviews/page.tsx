import { postgresSnapshotStore } from "@/lib/buffer/snapshot-store";
import { wroteIds } from "@/lib/written-store";
import { headers } from "next/headers";
import { ReviewsView } from "@/components/reviews-view";
import { signedInUserId } from "@/lib/current-user";
import { publicOrigin } from "@/lib/origin";
import { postgresReviewStore } from "@/lib/review-store";
import { exampleReviewLinks } from "@/lib/example-reviews";
import { demoShiftDays } from "@/lib/demo-clock";

export default async function Page() {
  const userId = await signedInUserId();
  // Signed out: the example account's shared link, read-only.
  if (!userId) return <ReviewsView origin={publicOrigin(await headers())} links={exampleReviewLinks(demoShiftDays())} example />;
  const links = await postgresReviewStore().list(userId).catch((e) => {
    console.error(JSON.stringify({ event: "qp-reviews-read-failed", message: e instanceof Error ? e.message : String(e) }));
    return null;
  });
  if (!links) return <section><h1>Reviews unavailable</h1><p role="alert">Could not read the review links. Refresh to try again.</p></section>;
  const snap = await postgresSnapshotStore().get(userId).catch(() => null);
  const drafts = snap?.data.posts.filter(p => p.status === "draft") ?? [];
  const ours = await wroteIds(userId, ...drafts.map(p => p.id)).catch(() => null);
  const candidates = drafts.filter(p => ours?.has(p.id)).map(p => { const c = snap?.data.channels.find(ch => ch.id === p.channelId); return { id: p.id, channelId: p.channelId, network: c?.service ?? "", label: c?.name ?? "Account", text: p.text }; });
  return <ReviewsView origin={publicOrigin(await headers())} links={links} candidates={candidates} candidatesUnavailable={!snap || !ours} />;
}
