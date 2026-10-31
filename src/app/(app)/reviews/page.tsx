import { headers } from "next/headers";
import { ReviewsView } from "@/components/reviews-view";
import { signedInUserId } from "@/lib/current-user";
import { publicOrigin } from "@/lib/origin";
import { postgresReviewStore } from "@/lib/review-store";

export default async function Page() {
  const userId = await signedInUserId();
  if (!userId) return <ReviewsView origin="" links={null} />;
  const links = await postgresReviewStore().list(userId).catch((e) => {
    console.error(JSON.stringify({ event: "qp-reviews-read-failed", message: e instanceof Error ? e.message : String(e) }));
    return [];
  });
  return <ReviewsView origin={publicOrigin(await headers())} links={links} />;
}
