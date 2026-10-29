import type { ReactNode } from "react";
import styles from "./status-page.module.css";

/**
 * Full-page message for "page not found" and "something broke": the name, one plain sentence, and a way out.
 * Shaped after the reference app's shared error page (title, explanation, error reference, retry and home).
 */
export function StatusPage({ title, body, reference, actions }: { title: string; body: string; reference?: string; actions: ReactNode }) {
  return (
    <main className={styles.page}>
      <div className={styles.box}>
        <a href="/" className={styles.brand}>Queue Pilot<span>.</span></a>
        <h1 className={styles.title}>{title}</h1>
        <p className={styles.body}>{body}</p>
        {reference && <p className={styles.ref}>Reference <code>{reference}</code></p>}
        <div className={styles.actions}>{actions}</div>
      </div>
    </main>
  );
}

export const statusLinkClass = styles.link;
