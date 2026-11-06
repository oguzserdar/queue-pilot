"use client";
import { useState, useTransition } from "react";
import type { FeedbackResult } from "@/lib/feedback-flow";
import { wordDiff } from "@/lib/word-diff";
import { Badge } from "@/registry/components/badge/badge";
import { Button } from "@/registry/components/button/button";
import SegmentedControl from "@/registry/components/segmented-control/segmented-control";
import styles from "./review-ui.module.css";

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

type Result = { ok: true } | { ok: false; message: string };
/** Where a kept preference applies: one option means it is fixed (a note's one account) and no choice is shown. */
export type KeepScopeOption = { value: string; label: string; help: string };

/**
 * One piece of feedback's checked plan: its classification, each proposed change inside its draft with Apply and Skip,
 * and, for a lasting preference, keeping it as a rule. Shared by review comments and teammates' Buffer notes.
 * Mount it with a new key for each new plan, so applied and kept state never carries over to another plan.
 */
export function FeedbackPlanView({ plan, from, labelFor, scopes, onApply, onKeep }: {
  plan: FeedbackResult;
  /** Whose words these are, as "Sam's comment" or "Sam's note". */
  from: string;
  labelFor: (postId: string) => string;
  scopes: KeepScopeOption[];
  onApply: (postId: string, after: string, before: string) => Promise<Result>;
  onKeep: (scope: string) => Promise<Result>;
}) {
  const [done, setDone] = useState<Record<string, { ok: boolean; text: string }>>({});
  const [scope, setScope] = useState(scopes[0]?.value ?? "accounts");
  const [kept, setKept] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, start] = useTransition();
  const apply = async (postId: string, after: string, before: string) => {
    try {
      const r = await onApply(postId, after, before);
      setDone(d => ({ ...d, [postId]: r.ok ? { ok: true, text: "Changed in Buffer" } : { ok: false, text: r.message } }));
    } catch { setDone(d => ({ ...d, [postId]: { ok: false, text: "Not confirmed. Open the draft before trying again." } })); }
  };
  const open = plan.edits.filter(e => !done[e.postId]?.ok && done[e.postId]?.text !== "Skipped");
  const chosen = scopes.find(s => s.value === scope) ?? scopes[0];

  return (
    <div className={styles.step}>
      <div className={styles.verdict}>
        <Badge tone={KIND[plan.kind].tone} size="sm">{KIND[plan.kind].label}</Badge>
        <p>{plan.reason}</p>
      </div>
      {plan.kind === "fact" && <p className={styles.callout}>{`This fact comes from ${from}. Queue Pilot didn't check it elsewhere, so make sure it's right before applying. Facts never become writing rules.`}</p>}
      {plan.kind === "unclear" && <p className={styles.callout}>{`${from.charAt(0).toUpperCase()}${from.slice(1)} doesn't say clearly what to change, so nothing is proposed. Ask them to point at the words.`}</p>}
      {plan.check === "failed" && <p role="alert" className={styles.callout}>The playbook check didn't finish. Applying a change runs it again first.</p>}

      {plan.edits.length > 0 && (
        <div className={styles.stepHead}>
          <h4 className={styles.h4}>{`${plan.edits.length} draft${plan.edits.length === 1 ? "" : "s"} would change`}</h4>
          {open.length > 1 && <Button size="sm" disabled={busy} onClick={() => start(async () => { for (const e of open) await apply(e.postId, e.after, e.before); })}>{`Apply all ${open.length}`}</Button>}
        </div>
      )}
      {plan.edits.length === 0 && plan.kind !== "unclear" && <p className={styles.help}>None of these drafts needs a change for this.</p>}

      <ul className={styles.changes}>
        {plan.edits.map(f => {
          const state = done[f.postId];
          const flags = plan.flags.filter(flag => flag.postId === f.postId);
          return (
            <li key={f.postId} className={styles.change} data-state={state?.ok ? "applied" : state?.text === "Skipped" ? "skipped" : undefined}>
              <div className={styles.stepHead}>
                <strong>{labelFor(f.postId)}</strong>
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
      {plan.refused.map(r => <p key={r.postId} className={styles.help}>{`Not changed: ${labelFor(r.postId)}. ${r.reason}`}</p>)}

      {plan.suggestionToken && chosen && (
        <div className={styles.ruleBox}>
          <h4 className={styles.h4}>Make it a rule for future drafts?</h4>
          <p className={styles.ruleText}>{plan.preference}</p>
          <span className={styles.hint}>Where it applies</span>
          {scopes.length > 1 ? <SegmentedControl label="Where it applies" options={scopes.map(({ value, label }) => ({ value, label }))} value={scope} onValueChange={setScope} /> : <p className={styles.ruleText}>{chosen.label}</p>}
          <p className={styles.help}>{chosen.help} Keeping the rule doesn&apos;t change the drafts above.</p>
          {message && <p role="alert" className={styles.error}>{message}</p>}
          <div className={styles.row}>
            <Button variant="secondary" size="sm" disabled={busy || kept} onClick={() => start(async () => {
              try { const r = await onKeep(scope); if (r.ok) setKept(true); else setMessage(r.message); }
              catch { setMessage("Could not keep that rule. Try again."); }
            })}>{kept ? "Kept in your playbook" : "Keep as a rule"}</Button>
          </div>
        </div>
      )}
    </div>
  );
}
