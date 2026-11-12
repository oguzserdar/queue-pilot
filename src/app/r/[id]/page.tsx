import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { postgresReviewStore } from "@/lib/review-store";
import { ReviewRoom } from "./review-room";

// A shared review is private to whoever has the link: never indexed, never followed.
export const metadata: Metadata = { title: "Review drafts · Queue Pilot", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const link = id.length <= 100 ? await postgresReviewStore().open(id).catch(() => null) : null;
  // Closed and unknown links answer 404 alike, so a link cannot be probed for whether it ever existed.
  if (!link) notFound();
  return <ReviewRoom id={id} drafts={link.drafts} initial={link.comments} />;
}
