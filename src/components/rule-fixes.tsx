"use client";

import { useState, useTransition } from "react";
import { editDraftText } from "@/app/(app)/actions";
import { proposeFixesForRule, type ShownFix } from "@/app/(app)/review-actions";
import { Button } from "@/registry/components/button/button";
import styles from "./playbook-view.module.css";

/**
 * After a rule is kept: check the drafts Queue Pilot wrote against it, and show each one that breaks it next to a
 * rewrite that follows it. Apply edits that draft in Buffer, through the usual playbook check; Leave changes nothing.
 */
export function RuleFixes({ ruleId }: { ruleId: string }) {
  const [pending, start] = useTransition();
  const [found, setFound] = useState<{ fixes: ShownFix[]; checked: number } | null>(null);
  const [done, setDone] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);

  const check = () => start(async () => {
    setMessage(null);
    const r = await proposeFixesForRule(ruleId);
    if (r.ok) { setFound(r); setDone({}); } else setMessage(r.message);
  });

  return (
    <div className={styles.fixes}>
      {!found && <Button variant="secondary" size="sm" disabled={pending} onClick={check}>{pending ? "Checking your drafts…" : "Check my drafts against it"}</Button>}
      {message && <p className={styles.problem} role="alert">{message}</p>}
      {found && found.fixes.length === 0 && (
        <p className={styles.muted} role="status">{found.checked ? `All ${found.checked} of Queue Pilot's drafts already follow it.` : "Queue Pilot has no drafts waiting in Buffer to check."}</p>
      )}
      {found?.fixes.map((f) => done[f.postId] ? (
        <p key={f.postId} className={styles.done} role="status">{done[f.postId]}</p>
      ) : (
        <section key={f.postId} className={styles.suggestion} aria-label={`Proposed change: ${f.label}`}>
          <p className={styles.muted}>{f.label}{f.problem ? ` · ${f.problem}` : ""}</p>
          <div className={styles.diff}>
            <blockquote className={styles.quote}>{f.before}</blockquote>
            <blockquote className={`${styles.quote} ${styles.proposed}`}>{f.after}</blockquote>
          </div>
          <div className={styles.actions}>
            <Button variant="primary" size="sm" disabled={pending} onClick={() => start(async () => {
              const r = await editDraftText(f.postId, f.after, f.before);
              if (r.ok) setDone((d) => ({ ...d, [f.postId]: `Changed in Buffer: ${f.label}` })); else setMessage(r.message);
            })}>Apply</Button>
            <Button variant="ghost" size="sm" disabled={pending} onClick={() => setDone((d) => ({ ...d, [f.postId]: `Left as it was: ${f.label}` }))}>Leave</Button>
          </div>
        </section>
      ))}
    </div>
  );
}
