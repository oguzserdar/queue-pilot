"use client";
import { useState, useTransition } from "react";
import { proposeCommentChanges, keepReviewPreference } from "@/app/(app)/review-actions";
import { editDraftText } from "@/app/(app)/actions";
import type { FeedbackResult } from "@/lib/feedback-flow";
import { NETWORKS } from "@/lib/rules";
import { Button } from "@/registry/components/button/button";
import { Checkbox } from "@/registry/components/checkbox/checkbox";
import { FeedbackPlanView } from "./feedback-plan-view";
import styles from "./review-ui.module.css";

export type ReviewCandidate = { id: string; channelId: string; network?: string; label: string; text: string };

/** At most this many drafts can change from one comment. */
const MAX_PICKS = 30;

/**
 * The drafts a comment starts with: only the draft it was written on, when that draft is still one of the candidates.
 * Every other draft is the person's choice to add.
 *
 * @param candidates - Drafts Queue Pilot wrote that the comment could change
 * @param postId - The draft the reviewer commented on
 * @returns The ids to tick when the panel opens
 */
export function firstPicks(candidates: ReviewCandidate[], postId: string): Set<string> {
  return new Set(candidates.some(c => c.id === postId) ? [postId] : []);
}

/**
 * One comment, carried into the drafts it is about: pick the drafts, preview each change inside its text, apply them
 * one by one or all at once, and separately keep a lasting preference at the scope you choose. It starts with only the
 * commented draft ticked, listed first; "Select all" adds the rest.
 *
 * @param postId - The draft the comment was written on
 * @param defaultOpen - Open the panel on first render instead of showing the "Suggest changes" link
 */
export function ReviewFeedback({ linkId, commentId, postId, reviewer, candidates: all, defaultOpen = false }: { linkId: string; commentId: string; postId: string; reviewer: string; candidates: ReviewCandidate[]; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  // The commented draft leads the list, so the one already ticked is the first thing read.
  const candidates = [...all.filter(c => c.id === postId), ...all.filter(c => c.id !== postId)];
  const [selected, setSelected] = useState(() => firstPicks(all, postId));
  const [plan, setPlan] = useState<FeedbackResult | null>(null);
  const [previews, setPreviews] = useState(0);
  const [message, setMessage] = useState("");
  const [busy, start] = useTransition();

  // A preview belongs to the drafts it was made for: changing the choice drops it, so Apply and Keep never use an old one.
  const changed = () => { if (plan) { setPlan(null); setMessage("You changed the drafts. Preview again to see the changes for these."); } };
  const toggle = (id: string, on: boolean) => {
    setSelected(s => { const n = new Set(s); if (on && n.size < MAX_PICKS) n.add(id); else n.delete(id); return n; });
    changed();
  };
  const most = Math.min(candidates.length, MAX_PICKS);
  const allPicked = selected.size >= most;
  const pickAll = () => { setSelected(allPicked ? new Set() : new Set(candidates.slice(0, MAX_PICKS).map(c => c.id))); changed(); };
  const commentedHere = candidates[0]?.id === postId;
  const preview = () => start(async () => {
    setMessage(""); setPlan(null);
    try { const r = await proposeCommentChanges(linkId, commentId, [...selected]); if (r.ok) { setPlan(r.plan); setPreviews(n => n + 1); } else setMessage(r.message); }
    catch { setMessage("Could not prepare changes. Nothing was changed. Try again."); }
  });
  const networks = [...new Set(candidates.filter(c => selected.has(c.id)).map(c => c.network).filter((n): n is string => !!n))];
  const scopes = [
    { value: "accounts", label: "These accounts", help: "Only the accounts these drafts are on will follow it." },
    ...networks.map(n => ({ value: `network:${n}`, label: `All ${NETWORKS[n] ?? n}`, help: `Every ${NETWORKS[n] ?? n} account will follow it.` })),
    { value: "shared", label: "Every account", help: "Every account will follow it, unless you turn it off for one." },
  ];

  if (!open) return <button type="button" className={styles.startLink} onClick={() => setOpen(true)} aria-label={`Suggest changes from ${reviewer}'s comment`}>Suggest changes <span aria-hidden="true">→</span></button>;

  return (
    <div className={styles.panel}>
      <div className={styles.step}>
        <div className={styles.stepHead}>
          <h4 className={styles.h4}>Which drafts is this comment about?</h4>
          <div className={styles.row}>
            <span className={styles.hint}>{`${selected.size} of ${candidates.length} chosen`}</span>
            {candidates.length > 1 && <Button variant="ghost" size="sm" disabled={busy} onClick={pickAll}>{allPicked ? "Clear" : "Select all"}</Button>}
          </div>
        </div>
        <p className={styles.help}>{commentedHere ? "The draft with the comment is ticked. Tick others if the comment is about them too. Only ticked drafts can change." : "The draft with the comment is no longer waiting in Buffer. Tick the drafts this comment is about. Only ticked drafts can change."}</p>
        <ul className={styles.pickList}>
          {candidates.map(c => (
            <li key={c.id}><Checkbox checked={selected.has(c.id)} disabled={busy} onCheckedChange={v => toggle(c.id, v === true)} label={`${c.label}${c.network ? ` · ${NETWORKS[c.network] ?? c.network}` : ""}${c.id === postId ? " · Has the comment" : ""}`} description={c.text.length > 140 ? `${c.text.slice(0, 140)}…` : c.text} /></li>
          ))}
        </ul>
        <div className={styles.row}>
          <Button variant="primary" size="sm" disabled={busy || !selected.size} onClick={preview}>{busy && !plan ? "Reading the comment…" : plan ? "Preview again" : `Preview changes to ${selected.size} draft${selected.size === 1 ? "" : "s"}`}</Button>
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => { setOpen(false); setPlan(null); setMessage(""); }}>Close</Button>
        </div>
      </div>

      {message && <p role="alert" className={styles.error}>{message}</p>}

      {plan && (
        <FeedbackPlanView key={previews} plan={plan} from={`${reviewer}'s comment`} scopes={scopes}
          labelFor={(postId) => candidates.find(c => c.id === postId)?.label ?? "a draft"}
          onApply={(postId, after, before) => editDraftText(postId, after, before)}
          onKeep={(value) => keepReviewPreference(plan.suggestionToken!, value === "shared" ? { level: "shared" } : value.startsWith("network:") ? { level: "network", network: value.slice(8) } : { level: "accounts" })} />
      )}
    </div>
  );
}
