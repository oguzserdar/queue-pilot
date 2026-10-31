"use client";

import { useState, useTransition } from "react";
import { turnOffReview } from "@/app/(app)/review-actions";
import { Button } from "@/registry/components/button/button";
import { CopyButton } from "@/registry/components/copy-button/copy-button";
import { NETWORKS } from "@/lib/rules";
import type { ReviewComment, ReviewLink } from "@/lib/review-limits";
import { FirstRulesFinder } from "./first-rules-finder";
import styles from "./playbook-view.module.css";

const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });

/**
 * Reviews: the links the person shared, what people said on each draft, and the rules those comments suggest.
 * `links` is null for someone signed out, who sees what the page is for.
 */
export function ReviewsView({ origin, links }: { origin: string; links: (ReviewLink & { comments: ReviewComment[] })[] | null }) {
  const [off, setOff] = useState<Set<string>>(new Set());
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const total = links?.reduce((n, l) => n + l.comments.length, 0) ?? 0;

  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <h1 className={styles.title}>{links === null ? "Reviews" : `Reviews: ${total} comment${total === 1 ? "" : "s"}`}</h1>
        <p className={styles.sub}>Share drafts from Next week with anyone, no account needed. They comment on the words, and Queue Pilot turns lasting requests into rules you can keep. Nothing is posted, and nothing changes until you keep it.</p>
      </header>
      {links === null ? (
        <p className={styles.muted}>Sign in with Buffer, then pick drafts on Next week and choose Share for review.</p>
      ) : links.length === 0 ? (
        <p className={styles.muted}>No review links yet. On Next week, choose Share for review.</p>
      ) : (
        <>
          <FirstRulesFinder source="comments" />
          {message && <p className={styles.problem} role="alert">{message}</p>}
          {links.map((l) => {
            const isOff = !!l.revokedAt || off.has(l.id);
            const url = `${origin}/r/${l.id}`;
            return (
              <section key={l.id} className={styles.block} aria-label={`Review link from ${day(l.createdAt)}`}>
                <h2 className={styles.h2}>{`${l.drafts.length} draft${l.drafts.length === 1 ? "" : "s"}, shared ${day(l.createdAt)}${isOff ? ", off" : ""}`}</h2>
                {!isOff && (
                  <div className={styles.actions}>
                    <CopyButton value={url} label="Copy link" />
                    <Button variant="ghost" size="sm" disabled={pending} onClick={() => start(async () => {
                      const r = await turnOffReview(l.id);
                      if (r.ok) setOff((s) => new Set(s).add(l.id)); else setMessage(r.message ?? "Could not turn it off.");
                    })}>Turn off</Button>
                  </div>
                )}
                {l.drafts.map((d) => {
                  const said = l.comments.filter((c) => c.postId === d.postId);
                  return (
                    <div key={d.postId} className={styles.suggestion}>
                      <p className={styles.muted}>{`${NETWORKS[d.network] ?? d.network} · ${d.channel}`}</p>
                      <blockquote className={styles.quote}>{d.text}</blockquote>
                      {said.length === 0 ? <p className={styles.muted}>No comments yet.</p> : said.map((c) => (
                        <p key={c.id} className={styles.proof}><strong>{c.name}</strong>{c.quote ? ` on "${c.quote}"` : ""}: {c.text}</p>
                      ))}
                    </div>
                  );
                })}
              </section>
            );
          })}
        </>
      )}
    </div>
  );
}
