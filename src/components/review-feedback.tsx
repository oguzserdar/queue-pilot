"use client";
import { useState, useTransition } from "react";
import { proposeCommentChanges, keepReviewPreference } from "@/app/(app)/review-actions";
import { editDraftText } from "@/app/(app)/actions";
import type { FeedbackResult } from "@/lib/feedback-flow";
import { Button } from "@/registry/components/button/button";
import styles from "./playbook-view.module.css";

export type ReviewCandidate = { id: string; channelId: string; label: string; text: string };
export function ReviewFeedback({ linkId, commentId, channelId, candidates }: { linkId: string; commentId: string; channelId?: string; candidates: ReviewCandidate[] }) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(() => new Set(candidates.filter(c => channelId && c.channelId === channelId).slice(0, 30).map(c => c.id)));
  const [plan, setPlan] = useState<FeedbackResult | null>(null);
  const [message, setMessage] = useState("");
  const [done, setDone] = useState<Record<string, string>>({});
  const [kept, setKept] = useState(false);
  const [busy, start] = useTransition();
  return <div className={styles.fixes}>
    {!open ? <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>Suggest changes from this comment</Button> : <>
      <p className={styles.muted}>Choose the drafts this feedback is for. Everything else stays as it is.</p>
      <fieldset className={styles.targetList}><legend>Drafts to review</legend>{candidates.map(c => <label key={c.id}>
        <input type="checkbox" checked={selected.has(c.id)} disabled={busy} onChange={e => setSelected(s => { const next = new Set(s); if (e.target.checked && next.size < 30) next.add(c.id); else next.delete(c.id); return next; })} />
        <span><strong>{c.label}</strong><span className={styles.muted}>{c.text.slice(0, 150)}</span></span>
      </label>)}</fieldset>
      <Button variant="primary" size="sm" disabled={busy || !selected.size} onClick={() => start(async () => {
        setMessage(""); setPlan(null); setDone({}); setKept(false);
        try { const r = await proposeCommentChanges(linkId, commentId, [...selected]); if (r.ok) setPlan(r.plan); else setMessage(r.message); }
        catch { setMessage("Could not prepare changes. Nothing was changed. Try again."); }
      })}>{busy ? "Reading the feedback…" : `Preview changes to ${selected.size} draft${selected.size === 1 ? "" : "s"}`}</Button>
    </>}
    {message && <p role="alert" className={styles.problem}>{message}</p>}
    {plan && <>
      <p><strong>{{ fact: "Fact correction", one_off: "One-off edit", preference: "Writing preference", unclear: "Needs clarification" }[plan.kind]}</strong> · {plan.reason}</p>
      {plan.check === "failed" && <p role="alert" className={styles.warning}>The playbook check did not finish. These changes are not verified against the rules. Applying a change will run the check again.</p>}
      {plan.kind === "fact" && <p className={styles.muted}>Based on this comment. Check the fact before applying. It will not become a writing rule.</p>}
      {plan.edits.length === 0 && <p className={styles.muted}>No changes ready to apply.</p>}
      {plan.refused.map(r => <p key={r.postId} className={styles.problem}>Not offered: {r.reason}</p>)}
      {plan.edits.map(f => <section key={f.postId} className={styles.suggestion} aria-label="Proposed draft change">
        <strong>{candidates.find(c => c.id === f.postId)?.label}</strong>{plan.flags.filter(flag => flag.postId === f.postId).map((flag, i) => <p key={i} className={styles.warning}>Check: {flag.rule} {flag.reason}</p>)}<p className={styles.muted}>{f.problem}</p>
        <div className={styles.diff}><div><small>Before</small><blockquote className={styles.quote}>{f.before}</blockquote></div><div><small>Proposed</small><blockquote className={`${styles.quote} ${styles.proposed}`}>{f.after}</blockquote></div></div>
        {done[f.postId] ? <p role="status">{done[f.postId]}</p> : <div className={styles.actions}>
          <Button size="sm" disabled={busy} onClick={() => start(async () => {
            try { const r = await editDraftText(f.postId, f.after, f.before); if (r.ok) setDone(d => ({ ...d, [f.postId]: "Changed in Buffer." })); else setMessage(r.message); }
            catch { setMessage("The change could not be confirmed. Read the draft before trying again."); }
          })}>Apply this change</Button>
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => setDone(d => ({ ...d, [f.postId]: "Left unchanged." }))}>Leave</Button>
        </div>}
      </section>)}
      {plan.suggestionToken && <section className={styles.suggestion}><strong>For future drafts</strong><p>{plan.preference}</p><p className={styles.muted}>Only for the selected accounts. Keeping this preference does not apply the edits above.</p>
        <Button variant="secondary" size="sm" disabled={busy || kept} onClick={() => start(async () => {
          try { const r = await keepReviewPreference(plan.suggestionToken!); if (r.ok) setKept(true); else setMessage(r.message); }
          catch { setMessage("Could not keep that preference. Try again."); }
        })}>{kept ? "Preference kept" : "Keep as a rule"}</Button>
      </section>}
    </>}
  </div>;
}
