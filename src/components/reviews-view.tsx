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
import { DEMO_TIME_ZONE } from "@/lib/demo-clock";
import styles from "./review-ui.module.css";
import page from "./reviews-view.module.css";
import { Pager } from "./pager";
import { useReaderClock } from "./reader-clock";

const DAY: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" };
const WHEN: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" };
const day = (iso: string) => <LocalTime iso={iso} options={DAY} />;
/**
 * The example's dates in its own time zone and the app's "16 Nov" style, the same for every visitor, so the shared
 * day, the expiry and the comment times always agree with each other and with the example week.
 */
const exampleDate = (iso: string, opts: Intl.DateTimeFormatOptions) => <time dateTime={iso}>{new Date(iso).toLocaleString("en-GB", { ...opts, timeZone: DEMO_TIME_ZONE })}</time>;

type Span = ReviewComment & { start: number; end: number };
type Link = ReviewLink & { comments: ReviewComment[] };

/** The words on a link's badge: turned off, expired, open until its expiry, or open. */
function LinkState({ isOff, expired, expiresAt, example }: { isOff: boolean; expired: boolean; expiresAt: string | null | undefined; example: boolean }) {
  if (isOff) return "Turned off";
  if (expired) return "Expired";
  if (!expiresAt) return "Open";
  return <>Open until {example ? exampleDate(expiresAt, DAY) : day(expiresAt)}</>;
}

/** One draft with comments: the draft with their words marked, and each comment with Suggest changes. */
function Thread({ link, draft: d, example, candidates }: { link: Link; draft: Link["drafts"][number]; example: boolean; candidates: ReviewCandidate[] | null }) {
  const said = link.comments.filter((c) => c.postId === d.postId);
  return (
    <article className={page.thread}>
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
              <span className={styles.hint}>{example ? exampleDate(c.createdAt, WHEN) : <LocalTime iso={c.createdAt} options={WHEN} relative />}</span>
            </div>
            {c.quote && <q className={page.quote}>{c.quote}</q>}
            <p className={page.body}>{c.text}</p>
            {candidates && <ReviewFeedback linkId={link.id} commentId={c.id} postId={c.postId} reviewer={c.name} candidates={candidates} />}
          </li>
        ))}
      </ol>
    </article>
  );
}

/** Copy link and Turn off while a link is live; Turn on again once it is off or expired. The example has none. */
function LinkActions({ url, live, pending, onOff, onOn }: { url: string; live: boolean; pending: boolean; onOff: () => void; onOn: () => void }) {
  if (!live) return <Button variant="secondary" size="sm" disabled={pending} onClick={onOn}>Turn on again</Button>;
  return (
    <div className={styles.row}>
      <CopyButton value={url} label="Copy link" />
      <Button variant="ghost" size="sm" disabled={pending} onClick={onOff}>Turn off</Button>
    </div>
  );
}

/** The draft with each commented span marked, so the comment beside it reads in place. */
function Marked({ text, comments }: { text: string; comments: ReviewComment[] }) {
  const spans = comments.filter((c): c is Span => c.start !== null && c.end !== null && c.end <= text.length).sort((a, b) => a.start - b.start);
  const parts: React.ReactNode[] = [];
  let at = 0;
  for (const c of spans) {
    if (c.start < at) continue;
    parts.push(text.slice(at, c.start), <mark key={c.id} className={page.mark} title={`${c.name}: ${c.text}`}>{text.slice(c.start, c.end)}</mark>);
    at = c.end;
  }
  parts.push(text.slice(at));
  return <p className={page.draftText}>{parts}</p>;
}

/**
 * Reviews: the links the person shared, what people said on each draft beside the words they meant, and, from any
 * comment, proposed changes to the drafts it is about. `links` is null for someone signed out.
 */
export function ReviewsView({ origin, links, candidates = [], candidatesUnavailable = false, example = false, pages }: { /** Bookmarks for the next older and newer pages of links. */ pages?: { older: string | null; newer: string | null }; /** The example account: read-only, no link actions. */ example?: boolean; candidatesUnavailable?: boolean; candidates?: ReviewCandidate[]; origin: string; links: (ReviewLink & { comments: ReviewComment[] })[] | null }) {
  const [off, setOff] = useState<Set<string>>(new Set());
  // Links turned back on here, with their expiry, until the page reloads from the server.
  const [on, setOn] = useState<Map<string, string>>(new Map());
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  // Expiry is judged on the reader's clock once the page runs; until then a link reads as not expired.
  const now = useReaderClock();
  const turnOff = (id: string) => start(async () => {
    const r = await turnOffReview(id);
    if (r.ok) { setOff((s) => new Set(s).add(id)); setOn((m) => { const n = new Map(m); n.delete(id); return n; }); } else setMessage(r.message ?? "Could not turn it off. Try again.");
  });
  const turnOn = (id: string) => start(async () => {
    const r = await turnOnReview(id);
    if (!r.ok) return setMessage(r.message);
    setMessage(null);
    setOn((m) => new Map(m).set(id, r.expiresAt));
    setOff((s) => { const n = new Set(s); n.delete(id); return n; });
  });

  return (
    <div className={page.page}>
      <header className={page.head}>
        <h1 className={page.title}>Reviews</h1>
        <p className={page.sub}>{example ? "What reviewers said on your drafts. Signed in, any comment can become edits to the draft." : "What reviewers said on your drafts. Turn any comment into edits."}</p>
        {example && <p className={page.sub}>Alex shared three drafts with Isabel, a client, and Sam, a teammate. They opened the link with no Buffer account and commented on the exact words they meant.</p>}
      </header>

      {links === null && <EmptyState title="Sign in to share drafts" description="Sign in with Buffer, then pick drafts on Next week and choose Share for review." />}
      {links !== null && links.length === 0 && (
        <EmptyState title="No review links yet" description="On Next week, choose Share for review, tick the drafts, and send the link to whoever you want feedback from." action={<Button variant="secondary" size="sm" onClick={() => { window.location.href = "/week"; }}>Go to Next week</Button>} />
      )}
      {links !== null && links.length > 0 && (
        <>
          {candidatesUnavailable && <p role="alert" className={styles.callout}>Your drafts couldn't be read just now, so changes can't be proposed. Comments are below. Refresh to try again.</p>}
          {message && <p className={styles.error} role="alert">{message}</p>}
          {links.map((l) => (
            <LinkCard key={l.id} link={l} origin={origin} example={example} now={now} expiresAt={on.get(l.id) ?? l.expiresAt} isOff={(!!l.revokedAt && !on.has(l.id)) || off.has(l.id)}
              candidates={!candidatesUnavailable && candidates.length > 0 ? candidates : null} pending={pending} onOff={() => turnOff(l.id)} onOn={() => turnOn(l.id)} />
          ))}
          {pages && <Pager path="/reviews" older={pages.older} newer={pages.newer} label="Review link pages" />}
        </>
      )}
    </div>
  );
}

/** One shared link: its drafts and when it closes, its actions, and each commented draft with its comments. */
function LinkCard({ link: l, origin, example, now, expiresAt, isOff, candidates, pending, onOff, onOn }: {
  link: Link;
  origin: string;
  example: boolean;
  now: number | null;
  expiresAt: string | null | undefined;
  isOff: boolean;
  candidates: ReviewCandidate[] | null;
  pending: boolean;
  onOff: () => void;
  onOn: () => void;
}) {
  const expired = !!(expiresAt && now !== null && Date.parse(expiresAt) <= now);
  const live = !isOff && !expired;
  const commented = l.drafts.filter((d) => l.comments.some((c) => c.postId === d.postId));
  const quiet = l.drafts.length - commented.length;
  return (
    <section className={page.link} aria-label="Review link">
      <div className={page.linkHead}>
        <div className={page.linkTitle}>
          <h2 className={page.h2}>{`${l.drafts.length} draft${l.drafts.length === 1 ? "" : "s"}, shared `}{example ? exampleDate(l.createdAt, DAY) : day(l.createdAt)}</h2>
          <Badge tone={live ? "success" : "neutral"} size="sm"><LinkState isOff={isOff} expired={expired} expiresAt={expiresAt} example={example} /></Badge>
          <span className={styles.hint}>{`${l.comments.length} comment${l.comments.length === 1 ? "" : "s"}`}</span>
        </div>
        {!example && <LinkActions url={`${origin}/r/${l.id}`} live={live} pending={pending} onOff={onOff} onOn={onOn} />}
      </div>
      {!live && !example && <p className={styles.help}>{expired && !isOff ? "This link has expired. Turn it on again for another 7 days." : "Reviewers can no longer open this link. Their comments stay here. Turn it on again to reopen the same link."}</p>}

      {commented.length === 0 && <p className={styles.help}>{live ? "No comments yet. Send the link to your reviewer." : "Nobody commented."}</p>}
      {commented.map((d) => <Thread key={d.postId} link={l} draft={d} example={example} candidates={candidates} />)}
      {quiet > 0 && commented.length > 0 && <p className={styles.help}>{`${quiet} other draft${quiet === 1 ? "" : "s"} in this link ${quiet === 1 ? "has" : "have"} no comments.`}</p>}
    </section>
  );
}
