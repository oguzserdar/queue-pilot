"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { checkMySources, recheckSourceEvidence, applySourceFix } from "@/app/(app)/source-actions";
import type { EvidenceCard } from "@/lib/source-presentation";
import { Button } from "@/registry/components/button/button";
import styles from "./source-evidence.module.css";

export function EvidenceDetail({ card }: { card: EvidenceCard }) {
  const url = card.uri.startsWith("http") ? new URL(card.uri) : null;
  if (url && card.locator) url.searchParams.set("t", card.locator.slice(2));
  return <div className={styles.evidence}>
    {url ? <a href={url.toString()} target="_blank" rel="noreferrer">{card.title}{card.locator ? ` · ${card.locator.slice(2)}s` : ""}</a> : <strong>{card.title}</strong>}
    <p className={styles.caption}>{card.quote ? "Quote matches the saved source" : "Quote not found in the source"}{card.captions === "auto" ? " · Auto captions: check names" : card.captions === "unknown" ? " · Caption type unknown: check names" : ""}{card.paidPreview ? " · Paid preview" : ""}{card.truncated ? " · Source excerpt only" : ""}</p>
    {card.quote && <blockquote>{card.quote}</blockquote>}
    <p className={styles.caption}>Claim when drafted: {card.claim}</p>
  </div>;
}

export function SourceEvidencePanel({ cards }: { cards: EvidenceCard[] }) {
  const [pending, start] = useTransition(); const [message, setMessage] = useState(""); const router = useRouter();
  const needs = cards.filter(c => c.needsCheck);
  const count = new Set(cards.map(c => c.postId)).size;
  const newest = cards.map(c => c.lastCheckedAt).sort().at(-1);
  const run = (action: () => Promise<{ ok: boolean; message?: string }>) => start(async () => { const r = await action(); setMessage(r.message ?? "Done."); router.refresh(); });
  return <section className={styles.panel} aria-label="Source evidence">
    <header className={styles.header}><div><h2>{needs.some(c => c.changed) ? "Source changed" : "Source evidence"}</h2><p className={styles.caption}>{cards.length ? `${count} ${count === 1 ? "draft" : "drafts"} with evidence` : "Evidence appears here when new drafts are written from sources."}{newest ? ` · Last checked ${newest.slice(0, 16).replace("T", " ")} UTC` : ""}</p></div>
      <Button variant="secondary" size="sm" disabled={pending} onClick={() => start(async () => { const r = await checkMySources(); setMessage(r.ok ? r.results.map(x => x.message).join("\n") || "No waiting drafts with sources to check." : r.message); router.refresh(); })}>{pending ? "Checking…" : "Check sources"}</Button>
    </header>
    {message && <p className={styles.message} role="status">{message}</p>}
    {needs.map((card, i) => <article className={styles.card} key={`${card.postId}-${card.snapshotId}-${i}`}>
      <EvidenceDetail card={card} />
      <p>{card.why}</p>
      {card.scheduled && <p role="alert" className={styles.warning}>This post is already scheduled in Buffer. Checking its source does not pause it. Review its schedule in Buffer.</p>}
      {card.changed && <details><summary>Compare source versions</summary><div className={styles.columns}><div><h3>When drafted</h3><p>{card.oldText}</p></div><div><h3>Latest source</h3><p>{card.newText}</p></div></div></details>}
      <div className={styles.columns}><div><h3>Current draft</h3><p>{card.draftText}</p></div>{card.rewrite && <div><h3>Proposed correction</h3><p>{card.rewrite}</p></div>}</div>
      <div className={styles.actions}>{card.rewrite && card.editable && <Button size="sm" disabled={pending} onClick={() => run(() => applySourceFix(card.postId, card.snapshotId))}>Apply to draft</Button>}<Button size="sm" variant="secondary" disabled={pending} onClick={() => run(() => recheckSourceEvidence(card.postId))}>Check evidence again</Button></div>
    </article>)}
  </section>;
}
