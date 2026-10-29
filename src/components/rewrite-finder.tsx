"use client";

import { useState, useTransition } from "react";
import { addRule, findRulesInRewrites, type RewriteProposal } from "@/app/(app)/actions";
import { Button } from "@/registry/components/button/button";
import styles from "./playbook-view.module.css";

/**
 * Find rules in my rewrites: on demand (it spends the person's AI credits), a model reads the drafts they rewrote in
 * Buffer and proposes rules, each shown with the rewrites it came from. Keep adds it as a "flag it" rule; Not now hides it.
 */
export function RewriteFinder() {
  const [pending, start] = useTransition();
  const [found, setFound] = useState<{ proposals: RewriteProposal[]; read: number } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [handled, setHandled] = useState<Record<number, "kept" | "dropped">>({});

  const find = () =>
    start(async () => {
      setMessage(null);
      const r = await findRulesInRewrites();
      if (r.ok) { setFound(r); setHandled({}); } else setMessage(r.message);
    });

  return (
    <section className={styles.block} aria-labelledby="rewrites-title">
      <h2 id="rewrites-title" className={styles.h2}>Rules from your rewrites</h2>
      <p className={styles.muted}>When you rewrite a draft in Buffer instead of fixing a word, your AI can read the rewrites and suggest the rule behind them. Each suggestion shows the rewrites it came from.</p>
      <div><Button variant="secondary" size="sm" disabled={pending} onClick={find}>{pending ? "Reading your rewrites…" : "Find rules in my rewrites"}</Button></div>
      {message && <p className={styles.problem} role="alert">{message}</p>}
      {found && found.proposals.length === 0 && <p className={styles.muted} role="status">Read {found.read} rewrites. No change repeats across two of them yet.</p>}
      {found?.proposals.map((p, i) =>
        handled[i] ? (
          <p key={i} className={styles.done} role="status">{handled[i] === "kept" ? `Kept: ${p.text}` : "Set aside."}</p>
        ) : (
          <section key={i} className={styles.offer} aria-label={`Suggested rule: ${p.text}`}>
            <h3 className={styles.h2}>{p.text}</h3>
            <p className={styles.muted}>{p.where}, from {p.examples.length} rewrites:</p>
            {p.examples.slice(0, 2).map((e, j) => <p key={j} className={styles.diff}><del><span className="sr-only">Before: </span>{e.before}</del> <span className="sr-only">After: </span>{e.after}</p>)}
            <div className={styles.actions}>
              <Button variant="primary" size="sm" disabled={pending} onClick={() => start(async () => {
                const r = await addRule({ kind: "guidance", text: p.text, channels: p.channels, level: "warn" });
                if (r.ok) setHandled((h) => ({ ...h, [i]: "kept" })); else setMessage(r.message);
              })}>Keep as a rule</Button>
              <Button variant="ghost" size="sm" onClick={() => setHandled((h) => ({ ...h, [i]: "dropped" }))}>Not now</Button>
            </div>
          </section>
        ),
      )}
    </section>
  );
}
