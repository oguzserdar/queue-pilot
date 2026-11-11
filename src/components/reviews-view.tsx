"use client";

import { ReviewFeedback, type ReviewCandidate } from "./review-feedback";
import { useState, useTransition } from "react";
import { turnOffReview, turnOnReview } from "@/app/(app)/review-actions";
import { Badge } from "@/registry/components/badge/badge";
import { Button } from "@/registry/components/button/button";
import { CopyButton } from "@/registry/components/copy-button/copy-button";
import { EmptyState } from "@/registry/components/empty-state/empty-state";
import { NETWORKS } from "@/lib/rules";
import type { ReviewComment, ReviewLink } from "@/lib/review-limits";
import { LocalTime } from "./local-time";
import styles from "./review-ui.module.css";
import page from "./reviews-view.module.css";

const DAY: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" };
const WHEN: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" };
const day = (iso: string) => <LocalTime iso={iso} options={DAY} />;

/** The draft with each commented span marked, so the comment beside it reads in place. */
function Marked({ text, comments }: { text: string; comments: ReviewComment[] }) {
  const spans = comments.filter((c) => c.start !== null && c.end !== null && c.end! <= text.length).sort((a, b) => a.start! - b.start!);
  const parts: React.ReactNode[] = [];
  let at = 0;
  for (const c of spans) {
    if (c.start! < at) continue;
    parts.push(text.slice(at, c.start!), <mark key={c.id} className={page.mark} title={`${c.name}: ${c.text}`}>{text.slice(c.start!, c.end!)}</mark>);
    at = c.end!;
  }
  parts.push(text.slice(at));
  return <p className={page.draftText}>{parts}</p>;
}

/**
 * Reviews: the links the person shared, what people said on each draft beside the words they meant, and, from any
 * comment, proposed changes to the drafts it is about. `links` is null for someone signed out.
 */
export function ReviewsView({ origin, links, candidates = [], candidatesUnavailable = false, example = false }: { /** The example account: read-only, no link actions. */ example?: boolean; candidatesUnavailable?: boolean; candidates?: ReviewCandidate[]; origin: string; links: (ReviewLink & { comments: ReviewComment[] })[] | null }) {
  const [off, setOff] = useState<Set<string>>(new Set());
  // Links turned back on here, with their expiry, until the page reloads from the server.
  const [on, setOn] = useState<Map<string, string>>(new Map());
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  return (
    <div className={page.page}>
      <header className={page.head}>
        <h1 className={page.title}>Reviews</h1>
        <p className={page.sub}>What reviewers said on your drafts. Turn any comment into edits.</p>
        {example && <p className={page.sub}>Alex shared three drafts with Isabel, a client, and Sam, a teammate. They opened the link with no Buffer account and commented on the exact words they meant.</p>}
      </header>

      {links === null ? (
        <EmptyState title="Sign in to share drafts" description="Sign in with Buffer, then pick drafts on Next week and choose Share for review." />
      ) : links.length === 0 ? (
        <EmptyState title="No review links yet" description="On Next week, choose Share for review, tick the drafts, and send the link to whoever you want feedback from." action={<Button variant="secondary" size="sm" onClick={() => { window.location.href = "/week"; }}>Go to Next week</Button>} />
      ) : (
        <>
          {candidatesUnavailable && <p role="alert" className={styles.callout}>Your drafts couldn't be read just now, so changes can't be proposed. Comments are below. Refresh to try again.</p>}
          {message && <p className={styles.error} role="alert">{message}</p>}
          {links.map((l) => {
            const expiresAt = on.get(l.id) ?? l.expiresAt;
            const expired = !!(expiresAt && Date.parse(expiresAt) <= Date.now());
            const isOff = ((!!l.revokedAt && !on.has(l.id)) || off.has(l.id));
            const live = !isOff && !expired;
            const url = `${origin}/r/${l.id}`;
            const commented = l.drafts.filter((d) => l.comments.some((c) => c.postId === d.postId));
            const quiet = l.drafts.length - commented.length;
            return (
              <section key={l.id} className={page.link} aria-label="Review link">
                <div className={page.linkHead}>
                  <div className={page.linkTitle}>
                    <h2 className={page.h2}>{`${l.drafts.length} draft${l.drafts.length === 1 ? "" : "s"}, shared `}{day(l.createdAt)}</h2>
                    <Badge tone={live ? "success" : "neutral"} size="sm">{isOff ? "Turned off" : expired ? "Expired" : expiresAt ? <>Open until {day(expiresAt)}</> : "Open"}</Badge>
                    <span className={styles.hint}>{`${l.comments.length} comment${l.comments.length === 1 ? "" : "s"}`}</span>
                  </div>
                  {live && !example && (
                    <div className={styles.row}>
                      <CopyButton value={url} label="Copy link" />
                      <Button variant="ghost" size="sm" disabled={pending} onClick={() => start(async () => {
                        const r = await turnOffReview(l.id);
                        if (r.ok) { setOff((s) => new Set(s).add(l.id)); setOn((m) => { const n = new Map(m); n.delete(l.id); return n; }); } else setMessage(r.message ?? "Could not turn it off. Try again.");
                      })}>Turn off</Button>
                    </div>
                  )}
                  {!live && !example && (
                    <Button variant="secondary" size="sm" disabled={pending} onClick={() => start(async () => {
                      const r = await turnOnReview(l.id);
                      if (!r.ok) return setMessage(r.message);
                      setMessage(null);
                      setOn((m) => new Map(m).set(l.id, r.expiresAt));
                      setOff((s) => { const n = new Set(s); n.delete(l.id); return n; });
                    })}>Turn on again</Button>
                  )}
                </div>
                {!live && !example && <p className={styles.help}>{expired && !isOff ? "This link has expired. Turn it on again for another 7 days." : "Reviewers can no longer open this link. Their comments stay here. Turn it on again to reopen the same link."}</p>}

                {commented.length === 0 && <p className={styles.help}>{live ? "No comments yet. Send the link to your reviewer." : "Nobody commented."}</p>}
                {commented.map((d) => {
                  const said = l.comments.filter((c) => c.postId === d.postId);
                  return (
                    <article key={d.postId} className={page.thread}>
                      <div className={page.draftCol}>
                        <p className={styles.hint}>{`${NETWORKS[d.network] ?? d.network} · ${d.channel}`}</p>
                        <Marked text={d.text} comments={said} />
                      </div>
                      <ol className={page.comments}>
                        {said.map((c) => (
                          <li key={c.id} className={page.comment}>
                            <div className={page.who}>
                              <span className={page.avatar} aria-hidden="true">{c.name.trim().charAt(0).toUpperCase()}</span>
                              <strong>{c.name}</strong>
                              <span className={styles.hint}><LocalTime iso={c.createdAt} options={WHEN} relative /></span>
                            </div>
                            {c.quote && <q className={page.quote}>{c.quote}</q>}
                            <p className={page.body}>{c.text}</p>
                            {!candidatesUnavailable && candidates.length > 0 && <ReviewFeedback linkId={l.id} commentId={c.id} channelId={d.channelId} reviewer={c.name} candidates={candidates} />}
                          </li>
                        ))}
                      </ol>
                    </article>
                  );
                })}
                {quiet > 0 && commented.length > 0 && <p className={styles.help}>{`${quiet} other draft${quiet === 1 ? "" : "s"} in this link ${quiet === 1 ? "has" : "have"} no comments.`}</p>}
              </section>
            );
          })}
        </>
      )}
    </div>
  );
}
