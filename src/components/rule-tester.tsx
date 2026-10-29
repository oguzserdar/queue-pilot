"use client";

import { useId, useState, useTransition } from "react";
import { tryDraft } from "@/app/(app)/actions";
import { Button } from "@/registry/components/button/button";
import { Select } from "@/registry/components/select/select";
import { Textarea } from "@/registry/components/textarea/textarea";
import { NETWORKS } from "@/lib/rules";
import type { Verdict } from "@/lib/judge";
import styles from "./playbook-view.module.css";

const LABEL = { pass: "Follows", fail: "Breaks", unsure: "Not sure" } as const;

/**
 * Try a draft: a model judges typed text against the playbook, the same check every save gets, so a rule can be seen
 * working in any language before any AI writes. Live mode checks on demand (it spends the person's AI credits); the
 * example shows a hand-written answer for its sample, labelled as such.
 */
export function RuleTester({ live, example }: { live: boolean; example: { text: string; network: string; verdicts: Verdict[] } }) {
  const [text, setText] = useState(live ? "" : example.text);
  const [network, setNetwork] = useState(example.network);
  const [answer, setAnswer] = useState<{ verdicts: Verdict[]; note: string } | null>(live ? null : { verdicts: example.verdicts, note: "Example answer for this sample." });
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const resultsId = useId();
  const blocked = answer?.verdicts.some((v) => v.verdict === "fail" && v.level === "block");

  const check = () =>
    start(async () => {
      setProblem(null);
      const r = await tryDraft(text, network);
      if (r.ok) setAnswer({ verdicts: r.verdicts, note: `Checked by a model with ${r.judgedWith}.` });
      else { setAnswer(null); setProblem(r.message); }
    });

  return (
    <section className={styles.tester} aria-labelledby="tester-title">
      <div className={styles.testerHead}>
        <h2 id="tester-title" className={styles.h2}>Try a draft</h2>
        <p className={styles.muted}>A model judges the text against your rules by meaning, in any language: the same check each draft gets before it is saved in Buffer.</p>
      </div>
      <div className={styles.testerFields}>
        <Textarea label="Draft" value={text} onChange={(e) => { setText(e.target.value); if (!live) setAnswer(null); }} rows={3} aria-describedby={resultsId} readOnly={!live} />
        <Select label="Network" value={network} onValueChange={setNetwork} options={Object.entries(NETWORKS).map(([value, label]) => ({ value, label }))} />
      </div>
      {live && <div><Button variant="secondary" size="sm" disabled={pending || !text.trim()} onClick={check}>{pending ? "Checking…" : "Check"}</Button></div>}
      <div id={resultsId} aria-live="polite" className={styles.verdictBox}>
        {problem && <p className={styles.problem} role="alert">{problem}</p>}
        {!answer && !problem && <p className={styles.muted}>{live ? "Type a draft and press Check." : "Sign in to check your own text."}</p>}
        {answer && (
          <>
            <p className={styles.verdict} data-blocked={blocked}>{answer.verdicts.length === 0 ? `No rules apply on ${NETWORKS[network]}.` : blocked ? "Would not be saved. It breaks a rule marked do not save." : "Would be saved."}</p>
            <ul className={styles.results}>
              {answer.verdicts.map((v) => (
                <li key={v.ruleId} className={styles.result} data-status={v.verdict === "unsure" ? "guidance" : v.verdict}>
                  <span className={styles.resultStatus}>{LABEL[v.verdict]}</span>
                  <span className={styles.text}>
                    <span>{v.rule}</span>
                    {v.quote && <span className={styles.muted}>Found "{v.quote}"</span>}
                    {v.reason && <span className={styles.muted}>{v.reason}</span>}
                  </span>
                </li>
              ))}
            </ul>
            <p className={styles.muted}>{answer.note}</p>
          </>
        )}
      </div>
    </section>
  );
}
