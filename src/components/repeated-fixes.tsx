"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { checkRepeatedFixes, keepRepeatedFix, setRepeatedFixAside, type RepeatedFix, type RepeatedFixesResult } from "@/app/(app)/fix-actions";
import { Button } from "@/registry/components/button/button";
import { SameFixOffer } from "./playbook-view";
import styles from "./playbook-view.module.css";

const WORDS = ["", "one", "two", "three", "four", "five"];

/** The calm line shown while the model reads the edits. */
export function readingLine(repeats: number, edits: number): string {
  if (repeats > 1) return "Reading the fixes you repeated…";
  return `Reading your ${WORDS[edits] ?? edits} edits…`;
}

type State = { kind: "reading" } | { kind: "read"; offers: RepeatedFix[]; note: string } | { kind: "failed"; message: string };

/**
 * The live Playbook's same-fix offer, at #fixes. Shown when a fix was repeated across drafts; on opening it asks the
 * model whether each repeat is a lasting preference (a saved answer costs nothing), then offers each one it confirmed
 * as a rule with Keep as a rule and Not now. When the model confirms none, one plain line says so.
 *
 * @param repeats - Open repeated fixes found without AI
 * @param edits - Drafts the first repeat was made in, for the reading line
 * @param preview - Development screens only: a fixed answer (or "reading") instead of asking the server
 */
export function RepeatedFixes({ repeats, edits, preview }: { repeats: number; edits: number; preview?: RepeatedFixesResult | "reading" }) {
  const [state, setState] = useState<State>(!preview || preview === "reading" ? { kind: "reading" } : preview.ok ? { kind: "read", offers: preview.offers, note: preview.note } : { kind: "failed", message: preview.message });
  const [handled, setHandled] = useState<Record<string, "kept" | "aside">>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, start] = useTransition();
  // One check per visit, even when React runs effects twice in development: a second ask would find the first busy.
  const asked = useRef(false);

  const check = () => {
    setState({ kind: "reading" });
    void checkRepeatedFixes().then(
      (r) => setState(r.ok ? { kind: "read", offers: r.offers, note: r.note } : { kind: "failed", message: r.message }),
      () => setState({ kind: "failed", message: "Queue Pilot could not read your edits just now. Try again in a minute." }),
    );
  };
  useEffect(() => {
    if (asked.current || preview) return;
    asked.current = true;
    check();
  }, []);

  const settle = (o: RepeatedFix, action: "kept" | "aside") => start(async () => {
    setProblem(null);
    if (preview) { setHandled((h) => ({ ...h, [o.token]: action })); return; }
    const r = await (action === "kept" ? keepRepeatedFix(o.token) : setRepeatedFixAside(o.token));
    if (r.ok) setHandled((h) => ({ ...h, [o.token]: action }));
    else setProblem(r.message);
  });

  return (
    <div id="fixes" className={styles.fixes}>
      {state.kind === "reading" && (
        <section className={styles.fixWait} aria-live="polite" aria-busy="true">
          <span className={styles.pulse} aria-hidden="true" />
          <span className={styles.text}>
            <strong>{readingLine(repeats, edits)}</strong>
            <span className={styles.muted}>You made the same fix more than once. Your AI is checking it is a habit, not a one-off.</span>
          </span>
        </section>
      )}
      {state.kind === "failed" && (
        <section className={styles.fixWait} role="alert">
          <span className={styles.text}>
            <strong>Your repeated fix was not checked</strong>
            <span className={styles.muted}>{state.message}</span>
          </span>
          <Button variant="secondary" size="sm" onClick={check}>Try again</Button>
        </section>
      )}
      {state.kind === "read" && state.offers.length === 0 && <p className={styles.muted} role="status">{state.note}</p>}
      {state.kind === "read" && state.offers.map((o) =>
        handled[o.token] === "kept" ? <p key={o.token} className={styles.done} role="status">Kept. {o.rule} is in your playbook now.</p>
        : handled[o.token] === "aside" ? <p key={o.token} className={styles.muted} role="status">Set aside. Queue Pilot won&apos;t offer this fix again.</p>
        : <SameFixOffer key={o.token} pending={pending} content={{ title: o.drafts === 2 ? "You made the same fix twice" : `You made the same fix in ${o.drafts} drafts`, before: o.before, after: o.after, change: o.change, where: o.where, rule: o.rule, why: o.why }}
            onKeep={() => settle(o, "kept")} onDismiss={() => settle(o, "aside")} />,
      )}
      {problem && <p className={styles.problem} role="alert">{problem}</p>}
    </div>
  );
}
