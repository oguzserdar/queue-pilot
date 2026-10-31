import type { Metadata } from "next";
import { postgresReviewStore } from "@/lib/review-store";
import { ReviewRoom } from "./review-room";
import styles from "./review.module.css";

// A shared review is private to whoever has the link: never indexed, never followed.
export const metadata: Metadata = { title: "Review drafts · Queue Pilot", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const link = id.length <= 100 ? await postgresReviewStore().open(id).catch(() => null) : null;
  if (!link) {
    return (
      <main className={styles.page}>
        <section className={styles.closed}>
          <p className={styles.mark}>Queue Pilot<span>.</span></p>
          <h1 className={styles.title}>This review link is closed</h1>
          <p className={styles.sub}>It was turned off or it expired. Ask the person who shared it for a new link. Comments already sent are still with them.</p>
        </section>
      </main>
    );
  }
  return <ReviewRoom id={id} drafts={link.drafts} initial={link.comments} />;
}
