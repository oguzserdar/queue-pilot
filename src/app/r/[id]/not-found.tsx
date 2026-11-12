import styles from "./review.module.css";

/** A review link that was turned off, expired or never existed: a 404, worded for the reviewer who opened it. */
export default function ClosedReview() {
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
