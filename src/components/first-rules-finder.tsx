"use client";

import { useState, useTransition } from "react";
import { addRule, dismissFirstRule, findFirstRules, type FirstRuleOffer } from "@/app/(app)/actions";
import { Button } from "@/registry/components/button/button";
import { EXAMPLE_FIRST_RULES } from "@/lib/example-first-rules";
import styles from "./playbook-view.module.css";

const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

const proofLine = (o: FirstRuleOffer) =>
  o.proof.kind === "posts"
    ? `Followed in ${o.proof.followed} of your ${o.proof.of} ${o.where} posts`
    : `From ${o.proof.by ? `${o.proof.by}'s note` : "a note"}${o.proof.at ? `, ${day(o.proof.at)}` : ""}, on a ${o.where} post`;

/**
 * Find my first rules: on demand (it spends the person's AI credits), a model reads their recent sent posts and the
 * notes their team left in Buffer. Each rule shows its proof; Keep adds it as a "flag it" rule; Not now is remembered, so it is not offered again.
 */
export function FirstRulesFinder({ open = false, onExampleKeep }: { open?: boolean; onExampleKeep?: (o: FirstRuleOffer) => void }) {
  const [pending, start] = useTransition();
  const [found, setFound] = useState<{ offers: FirstRuleOffer[]; skipped: string[] } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [handled, setHandled] = useState<Record<number, "kept" | "dropped">>({});

  const find = () =>
    start(async () => {
      setMessage(null);
      if (onExampleKeep) { setFound(EXAMPLE_FIRST_RULES); setHandled({}); return; }
      const r = await findFirstRules();
      if (r.ok) { setFound(r); setHandled({}); } else setMessage(r.message);
    });

  return (
    <section className={open ? styles.offer : styles.block} aria-labelledby="first-rules-title">
      <h2 id="first-rules-title" className={styles.h2}>Rules from your past posts</h2>
      <p className={styles.muted}>Your AI reads your last 20 sent posts on each network and the notes your team left on them in Buffer. Each rule it finds shows its proof. A rule you keep flags drafts that break it; it never blocks one.</p>
      <div><Button variant={open && !found ? "primary" : "secondary"} size="sm" disabled={pending} onClick={find}>{pending ? "Reading your posts…" : found ? "Look again" : "Find rules in my past posts"}</Button></div>
      {message && <p className={styles.problem} role="alert">{message}</p>}
      {found && found.offers.length === 0 && <p className={styles.muted} role="status">No habit of yours holds in every post yet, and no note asks for one.</p>}
      {found && found.skipped.length > 0 && <p className={styles.muted}>Skipped {found.skipped.join(", ")}: fewer than 10 sent posts.</p>}
      {found?.offers.map((o, i) =>
        handled[i] ? (
          <p key={i} className={styles.done} role="status">{handled[i] === "kept" ? `Kept: ${o.text}` : "Set aside."}</p>
        ) : (
          <section key={i} className={styles.suggestion} aria-label={`Suggested rule: ${o.text}`}>
            <h3 className={styles.h2}>{o.text}</h3>
            <p className={styles.proof}>✓ {proofLine(o)}</p>
            {o.proof.kind === "note" ? (
              <>
                <blockquote className={styles.quote}>{o.proof.note}</blockquote>
                <p className={styles.muted}>On: {o.proof.post}</p>
              </>
            ) : (
              <>
                {o.proof.examples.map((e, j) => <blockquote key={j} className={styles.quote}>{e}</blockquote>)}
                {o.proof.unclear > 0 && (
                  <p className={styles.muted}>Not counted, because the rule may not apply: {o.proof.unclearPosts.map((t) => `"${t}"`).join(", ")}{o.proof.unclear > o.proof.unclearPosts.length ? ` and ${o.proof.unclear - o.proof.unclearPosts.length} more` : ""}.</p>
                )}
              </>
            )}
            <div className={styles.actions}>
              <Button variant="primary" size="sm" disabled={pending} onClick={() => start(async () => {
                if (onExampleKeep) { onExampleKeep(o); setHandled((h) => ({ ...h, [i]: "kept" })); return; }
                const r = await addRule({ kind: "guidance", text: o.text, channels: o.channels, level: "warn" });
                if (r.ok) setHandled((h) => ({ ...h, [i]: "kept" })); else setMessage(r.message);
              })}>Keep</Button>
              <Button variant="ghost" size="sm" disabled={pending} onClick={() => start(async () => {
                if (onExampleKeep) { setHandled((h) => ({ ...h, [i]: "dropped" })); return; }
                const r = await dismissFirstRule(o.key);
                if (r.ok) setHandled((h) => ({ ...h, [i]: "dropped" })); else setMessage(r.message);
              })}>Not now</Button>
            </div>
          </section>
        ),
      )}
    </section>
  );
}
