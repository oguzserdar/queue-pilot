"use client";
import { useState, useTransition } from "react";
import { proposeCommentChanges, keepReviewPreference } from "@/app/(app)/review-actions";
import { editDraftText } from "@/app/(app)/actions";
import type { FeedbackResult } from "@/lib/feedback-flow";
import { NETWORKS } from "@/lib/rules";
import { wordDiff } from "@/lib/word-diff";
import { Badge } from "@/registry/components/badge/badge";
import { Button } from "@/registry/components/button/button";
import { Checkbox } from "@/registry/components/checkbox/checkbox";
import SegmentedControl from "@/registry/components/segmented-control/segmented-control";
import styles from "./review-ui.module.css";

export type ReviewCandidate = { id: string; channelId: string; network?: string; label: string; text: string };

const KIND = {
  fact: { label: "Fact correction", tone: "warning" },
  one_off: { label: "One-off edit", tone: "neutral" },
  preference: { label: "Lasting preference", tone: "info" },
  unclear: { label: "Needs a clearer comment", tone: "neutral" },
} as const;

/** A rule check line without doubled punctuation: "Explain why it matters: no reason is given." */
const flagLine = (rule: string, reason: string) => `${rule.trim().replace(/[.!?]+$/, "")}: ${reason.trim()}`;

/** The proposed text with removed words struck through and added words marked, inside the post itself. */
function InlineDiff({ before, after }: { before: string; after: string }) {
  return (
    <p className={styles.diffText}>
      {wordDiff(before, after).map((p, i) => p.kind === "same" ? <span key={i}>{p.text}</span> : p.kind === "removed" ? <del key={i}>{p.text}</del> : <ins key={i}>{p.text}</ins>)}
    </p>
  );
}

/**
 * One comment, carried into the drafts it is about: pick the drafts, preview each change inside its text, apply them
 * one by one or all at once, and separately keep a lasting preference at the scope you choose.
 */
export function ReviewFeedback({ linkId, commentId, channelId, reviewer, candidates }: { linkId: string; commentId: string; channelId?: string; reviewer: string; candidates: ReviewCandidate[] }) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(() => new Set(candidates.filter(c => channelId && c.channelId === channelId).slice(0, 30).map(c => c.id)));
  const [plan, setPlan] = useState<FeedbackResult | null>(null);
  const [message, setMessage] = useState("");
  const [done, setDone] = useState<Record<string, { ok: boolean; text: string }>>({});
  const [scope, setScope] = useState("accounts");
  const [kept, setKept] = useState(false);
  const [busy, start] = useTransition();

  // A preview belongs to the drafts it was made for: changing the choice drops it, so Apply and Keep never use an old one.
  const toggle = (id: string, on: boolean) => {
    setSelected(s => { const n = new Set(s); if (on && n.size < 30) n.add(id); else n.delete(id); return n; });
    if (plan) { setPlan(null); setDone({}); setKept(false); setMessage("You changed the drafts. Preview again to see the changes for these."); }
  };
  const preview = () => start(async () => {
    setMessage(""); setPlan(null); setDone({}); setKept(false); setScope("accounts");
    try { const r = await proposeCommentChanges(linkId, commentId, [...selected]); if (r.ok) setPlan(r.plan); else setMessage(r.message); }
    catch { setMessage("Could not prepare changes. Nothing was changed. Try again."); }
  });
  const apply = async (postId: string, after: string, before: string) => {
    try {
      const r = await editDraftText(postId, after, before);
      setDone(d => ({ ...d, [postId]: r.ok ? { ok: true, text: "Changed in Buffer" } : { ok: false, text: r.message } }));
    } catch { setDone(d => ({ ...d, [postId]: { ok: false, text: "Not confirmed. Open the draft before trying again." } })); }
  };
  const open_ = plan?.edits.filter(e => !done[e.postId]?.ok && done[e.postId]?.text !== "Skipped") ?? [];
  const networks = [...new Set(candidates.filter(c => selected.has(c.id)).map(c => c.network).filter((n): n is string => !!n))];
  const scopes = [
    { value: "accounts", label: "These accounts" },
    ...networks.map(n => ({ value: `network:${n}`, label: `All ${NETWORKS[n] ?? n}` })),
    { value: "shared", label: "Every account" },
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
        <div className={styles.step}>
          <div className={styles.verdict}>
            <Badge tone={KIND[plan.kind].tone} size="sm">{KIND[plan.kind].label}</Badge>
            <p>{plan.reason}</p>
          </div>
          {plan.kind === "fact" && <p className={styles.callout}>{`This fact comes from ${reviewer}'s comment. Queue Pilot didn't check it elsewhere, so make sure it's right before applying. Facts never become writing rules.`}</p>}
          {plan.kind === "unclear" && <p className={styles.callout}>The comment doesn't say clearly what to change, so nothing is proposed. Ask the reviewer to point at the words.</p>}
          {plan.check === "failed" && <p role="alert" className={styles.callout}>The playbook check didn't finish. Applying a change runs it again first.</p>}

          {plan.edits.length > 0 && (
            <div className={styles.stepHead}>
              <h4 className={styles.h4}>{`${plan.edits.length} draft${plan.edits.length === 1 ? "" : "s"} would change`}</h4>
              {open_.length > 1 && <Button size="sm" disabled={busy} onClick={() => start(async () => { for (const e of open_) await apply(e.postId, e.after, e.before); })}>{`Apply all ${open_.length}`}</Button>}
            </div>
          )}
          {plan.edits.length === 0 && plan.kind !== "unclear" && <p className={styles.help}>None of the chosen drafts needs a change for this comment.</p>}

          <ul className={styles.changes}>
            {plan.edits.map(f => {
              const state = done[f.postId];
              const flags = plan.flags.filter(flag => flag.postId === f.postId);
              return (
                <li key={f.postId} className={styles.change} data-state={state?.ok ? "applied" : state?.text === "Skipped" ? "skipped" : undefined}>
                  <div className={styles.stepHead}>
                    <strong>{candidates.find(c => c.id === f.postId)?.label ?? "Draft"}</strong>
                    {state?.ok && <Badge tone="success" size="sm">Applied</Badge>}
                    {state?.text === "Skipped" && <Badge tone="neutral" size="sm">Skipped</Badge>}
                  </div>
                  <InlineDiff before={f.before} after={f.after} />
                  <p className={styles.help}>{f.problem}</p>
                  {flags.map((flag, i) => <p key={i} className={styles.flag}>{`Your playbook flags this: ${flagLine(flag.rule, flag.reason)}`}</p>)}
                  {state && !state.ok && state.text !== "Skipped" && <p role="alert" className={styles.error}>{state.text}</p>}
                  {!state?.ok && state?.text !== "Skipped" && (
                    <div className={styles.row}>
                      <Button size="sm" disabled={busy} onClick={() => start(() => apply(f.postId, f.after, f.before))}>Apply</Button>
                      <Button variant="ghost" size="sm" disabled={busy} onClick={() => setDone(d => ({ ...d, [f.postId]: { ok: false, text: "Skipped" } }))}>Skip</Button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          {plan.refused.map(r => <p key={r.postId} className={styles.help}>{`Not changed: ${candidates.find(c => c.id === r.postId)?.label ?? "a draft"}. ${r.reason}`}</p>)}

          {plan.suggestionToken && (
            <div className={styles.ruleBox}>
              <h4 className={styles.h4}>Make it a rule for future drafts?</h4>
              <p className={styles.ruleText}>{plan.preference}</p>
              <span className={styles.hint}>Where it applies</span>
              <SegmentedControl label="Where it applies" options={scopes} value={scope} onValueChange={setScope} />
              <p className={styles.help}>{scope === "shared" ? "Every account will follow it, unless you turn it off for one." : scope.startsWith("network:") ? `Every ${NETWORKS[scope.slice(8)] ?? scope.slice(8)} account will follow it.` : "Only the accounts these drafts are on will follow it."} Keeping the rule doesn't change the drafts above.</p>
              <div className={styles.row}>
                <Button variant="secondary" size="sm" disabled={busy || kept} onClick={() => start(async () => {
                  const s = scope === "shared" ? { level: "shared" as const } : scope.startsWith("network:") ? { level: "network" as const, network: scope.slice(8) } : { level: "accounts" as const };
                  try { const r = await keepReviewPreference(plan.suggestionToken!, s); if (r.ok) setKept(true); else setMessage(r.message); }
                  catch { setMessage("Could not keep that rule. Try again."); }
                })}>{kept ? "Kept in your playbook" : "Keep as a rule"}</Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
