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

/**
 * One comment, carried into the drafts it is about: pick the drafts, preview each change inside its text, apply them
 * one by one or all at once, and separately keep a lasting preference at the scope you choose.
 */
export function ReviewFeedback({ linkId, commentId, channelId, reviewer, candidates }: { linkId: string; commentId: string; channelId?: string; reviewer: string; candidates: ReviewCandidate[] }) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(() => new Set(candidates.filter(c => channelId && c.channelId === channelId).slice(0, 30).map(c => c.id)));
  const [plan, setPlan] = useState<FeedbackResult | null>(null);
  const [previews, setPreviews] = useState(0);
  const [message, setMessage] = useState("");
  const [busy, start] = useTransition();

  // A preview belongs to the drafts it was made for: changing the choice drops it, so Apply and Keep never use an old one.
  const toggle = (id: string, on: boolean) => {
    setSelected(s => { const n = new Set(s); if (on && n.size < 30) n.add(id); else n.delete(id); return n; });
    if (plan) { setPlan(null); setMessage("You changed the drafts. Preview again to see the changes for these."); }
  };
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
          <span className={styles.hint}>{`${selected.size} of ${candidates.length} chosen`}</span>
        </div>
        <p className={styles.help}>Only the drafts you tick can change. The rest stay exactly as they are.</p>
        <ul className={styles.pickList}>
          {candidates.map(c => (
            <li key={c.id}><Checkbox checked={selected.has(c.id)} disabled={busy} onCheckedChange={v => toggle(c.id, v === true)} label={`${c.label}${c.network ? ` · ${NETWORKS[c.network] ?? c.network}` : ""}`} description={c.text.length > 140 ? `${c.text.slice(0, 140)}…` : c.text} /></li>
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
