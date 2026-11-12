"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { checkMySources, recheckSourceEvidence, applySourceFix } from "@/app/(app)/source-actions";
import type { EvidenceCard } from "@/lib/source-presentation";
import { groupBySource, quoteNeedsAttention, quoteWarnings } from "@/lib/source-groups";
import { ChevronDown, ExternalLink, FileText, RotateCw } from "lucide-react";
import { sourceTimestamp, sourceCheckedTime, sourceDraftTime } from "@/lib/source-labels";
import { Button } from "@/registry/components/button/button";
import styles from "./source-evidence.module.css";

export function EvidenceDetail({ card }: { card: EvidenceCard }) {
  const url = card.uri.startsWith("http") ? new URL(card.uri) : null;
  if (url && card.locator) url.searchParams.set("t", card.locator.slice(2));
  return <div className={styles.evidence}>
    {url ? <a href={url.toString()} target="_blank" rel="noreferrer">{card.title}{card.locator ? ` · ${sourceTimestamp(card.locator)}` : ""}</a> : <strong>{card.title}</strong>}
    <p className={styles.caption}>{card.quote ? "Quote matches the saved source" : "Quote not found in the source"}{card.kind === "video-description" ? " · Video description only" : ""}{card.captions === "auto" ? " · Auto captions: check names" : card.captions === "unknown" ? " · Caption type unknown: check names" : ""}{card.paidPreview ? " · Paid preview" : ""}{card.truncated ? " · Source excerpt only" : ""}</p>
    {card.quote && <blockquote>{card.quote}</blockquote>}
    <p className={styles.caption}>Claim when drafted: {card.claim}</p>
  </div>;
}

/** One quote: what the draft says and what the source says, labelled. */
function QuotePair({ c }: { c: EvidenceCard }) {
  const problems = quoteWarnings(c);
  // A quote from a video or podcast links to its own moment; other address parameters are kept.
  const at = c.locator && c.uri.startsWith("http") ? (() => { const u = new URL(c.uri); u.searchParams.set("t", c.locator.slice(2)); return u.toString(); })() : null;
  return <div className={styles.pair}>
    {problems.length > 0 && <p className={styles.warning} role="note">{problems.join(" · ")}</p>}
    <p className={styles.pairLabel}>In this draft</p>
    <p className={styles.pairText}>{c.claim}</p>
    <p className={styles.pairLabel}>From the source{at && c.locator ? <> · <a href={at} target="_blank" rel="noreferrer">{sourceTimestamp(c.locator)}</a></> : null}</p>
    <p className={styles.pairText}>{c.quote ?? "No matching words were found."}</p>
  </div>;
}

/**
 * A draft's sources, each shown once with its quotes inside. The first quote is open; the others are folded unless they
 * have a problem, which always stays open.
 */
export function DraftSources({ cards, live }: { cards: EvidenceCard[]; live: boolean }) {
  const [pending, start] = useTransition(); const [message, setMessage] = useState(""); const router = useRouter();
  if (!cards.length) return null;
  const groups = groupBySource(cards);
  const quotes = cards.length;
  return <section className={styles.sources} aria-label="Sources">
    <div className={styles.sourcesHead}><h3>Sources</h3><span className={styles.caption}>{groups.length} {groups.length === 1 ? "source" : "sources"} · {quotes} {quotes === 1 ? "quote" : "quotes"}</span></div>
    {groups.map((g) => {
      const url = g.uri.startsWith("http") ? g.uri : null;
      return <div key={g.key} className={styles.group}>
        <div className={styles.groupHead}>
          <span className={styles.groupIcon} aria-hidden="true"><FileText size={16} strokeWidth={1.75} /></span>
          <div className={styles.groupTitle}>
            {url ? <a href={url} target="_blank" rel="noreferrer">{g.title}<ExternalLink size={13} strokeWidth={1.75} aria-hidden="true" /></a> : <strong>{g.title}</strong>}
            <span className={styles.caption}>{g.found} of {g.quotes.length} {g.quotes.length === 1 ? "quote" : "quotes"} found in the saved source. Quote matching checks the words, not the claim.</span>
          </div>
        </div>
        {g.quotes.map((c, i) => i === 0 || quoteNeedsAttention(c)
          ? <QuotePair key={`${c.snapshotId}-${i}`} c={c} />
          : <details key={`${c.snapshotId}-${i}`} className={styles.folded}><summary><ChevronDown size={15} strokeWidth={1.75} aria-hidden="true" className={styles.chevron} /><span className={styles.pairLabel}>Quote {i + 1}</span><span className={styles.summaryText}>{c.claim}</span></summary><QuotePair c={c} /></details>)}
      </div>;
    })}
    <div className={styles.recheck}><button type="button" className={styles.linkButton} disabled={pending} onClick={() => live ? start(async () => { const r = await recheckSourceEvidence(cards[0].postId); setMessage(r.message ?? "Checked."); router.refresh(); }) : setMessage("Example account: the quotes above are already checked against the saved issue.")}><RotateCw size={14} strokeWidth={1.75} aria-hidden="true" />{pending ? "Rechecking…" : "Recheck draft"}</button><span className={styles.caption}>Checks the saved source again, without fetching the page.</span></div>
    {message && <p className={styles.caption} role="status">{message}</p>}
  </section>;
}

export function SourceEvidencePanel({ cards, timeZone = "UTC" }: { cards: EvidenceCard[]; timeZone?: string }) {
  const [pending, start] = useTransition(); const [message, setMessage] = useState(""); const router = useRouter();
  const needs = cards.filter(c => c.needsCheck);
  const checked = cards.filter(c => !c.needsCheck);
  const affected = new Map<string, Set<string>>();
  for (const card of needs) { const key = card.sourceKey ?? card.uri; const ids = affected.get(key) ?? new Set<string>(); ids.add(card.postId); affected.set(key, ids); }
  const count = new Set(cards.map(c => c.postId)).size;
  const newest = cards.map(c => c.lastCheckedAt).sort().at(-1);
  const run = (action: () => Promise<{ ok: boolean; message?: string }>) => start(async () => { const r = await action(); setMessage(r.message ?? "Done."); router.refresh(); });
  return <section className={styles.panel} aria-label="Source evidence">
    <header className={styles.header}><div><h2>{needs.some(c => c.changed) ? "Source changed" : "Source evidence"}</h2><p className={styles.caption}>{cards.length ? `${count} ${count === 1 ? "draft" : "drafts"} with evidence` : "Evidence appears here when new drafts are written from sources."}{newest ? ` · Last checked ${sourceCheckedTime(newest, timeZone)}` : ""}</p></div>
      <Button variant="secondary" size="sm" disabled={pending} onClick={() => start(async () => { const r = await checkMySources(); setMessage(r.ok ? r.results.map(x => x.message).join("\n") || "No waiting drafts with sources to check." : r.message); router.refresh(); })}>{pending ? "Checking…" : "Check sources"}</Button>
    </header>
    {message && <p className={styles.message} role="status">{message}</p>}
    {checked.length > 0 && <details className={styles.checked}>
      <summary>View saved quotes and drafts ({new Set(checked.map(c => c.postId)).size})</summary>
      {checked.map((card, i) => <article className={styles.card} key={`${card.postId}-${card.snapshotId}-${i}`}>
        <h3>{card.channel ?? "Draft"}{card.network ? ` · ${card.network === "twitter" ? "X" : card.network === "linkedin" ? "LinkedIn" : card.network}` : ""} · {sourceDraftTime(card.dueAt, card.timeZone ?? timeZone)}</h3>
        <p className={styles.message}>{card.draftText}</p>
        <EvidenceDetail card={card} />
      </article>)}
    </details>}
    {needs.map((card, i) => <article className={styles.card} key={`${card.postId}-${card.snapshotId}-${i}`}>
      <h3>{card.channel ?? "Draft"}{card.network ? ` · ${card.network === "twitter" ? "X" : card.network === "linkedin" ? "LinkedIn" : card.network}` : ""} · {sourceDraftTime(card.dueAt, card.timeZone ?? timeZone)}</h3>
      <p className={styles.caption}>{(affected.get(card.sourceKey ?? card.uri)?.size ?? 0)} {(affected.get(card.sourceKey ?? card.uri)?.size ?? 0) === 1 ? "draft needs" : "drafts need"} review from this source</p>
      <EvidenceDetail card={card} />
      <p>{card.why}</p>
      {card.scheduled && <p role="alert" className={styles.warning}>This post is already scheduled in Buffer. Checking its source does not pause it. Review its schedule in Buffer.</p>}
      {card.changed && <details><summary>Compare source versions</summary><div className={styles.columns}><div><h3>When drafted</h3><p>{card.oldText}</p></div><div><h3>Latest source</h3><p>{card.newText}</p></div></div></details>}
      <div className={styles.columns}><div><h3>Current draft</h3><p>{card.draftText}</p></div>{card.rewrite && <div><h3>Proposed correction</h3><p>{card.rewrite}</p></div>}</div>
      <div className={styles.actions}>{card.rewrite && card.editable && <Button size="sm" disabled={pending} onClick={() => run(() => applySourceFix(card.postId, card.snapshotId))}>Apply to draft</Button>}<Button size="sm" variant="secondary" disabled={pending} onClick={() => run(() => recheckSourceEvidence(card.postId))}>Check evidence again</Button></div>
    </article>)}
  </section>;
}
