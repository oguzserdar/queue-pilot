"use client";

import { DRAFT_CHECKS } from "@/lib/draft-checks";

import { useState, useTransition } from "react";
import { addRule, readRule, removeRule } from "@/app/(app)/actions";
import { Badge } from "@/registry/components/badge/badge";
import { Button } from "@/registry/components/button/button";
import { NETWORKS, ruleHold, type NewRule, type Rule } from "@/lib/rules";
import { EXAMPLE_RULES } from "@/lib/example-playbook";
import { EXAMPLE_TRY } from "@/lib/example-verdicts";
import { useToastStack } from "@/registry/components/toast-stack/toast-stack";
import { ConfirmButton } from "./confirm-button";
import { RuleForm } from "./rule-form";
import { FirstRulesFinder } from "./first-rules-finder";
import { RewriteFinder } from "./rewrite-finder";
import { RuleTester } from "./rule-tester";
import styles from "./playbook-view.module.css";

/** A rule as the Playbook shows it: the rule, and the edits it came from when there were any. */
export type ShownRule = Rule & { origin?: string };

const EXAMPLE: ShownRule[] = EXAMPLE_RULES;
const OFFERED: ShownRule = { id: "r5", kind: "guidance", channels: ["instagram"], level: "warn", text: "Start with the dish, not a feeling.", origin: "You changed the opening in 2 drafts" };
const HOLD_TONE = { "Not saved": "danger", Flagged: "warning" } as const;
const HOLD_HINT = { "Not saved": "A draft that breaks it is rewritten once, then not saved", Flagged: "A draft that breaks it is saved and flagged for you" };

const groupName = (r: Rule) => (r.channels === "all" ? "Every network" : r.channels.map((c) => NETWORKS[c] ?? c).join(", "));

function groups(rules: ShownRule[]): [string, ShownRule[]][] {
  const m = new Map<string, ShownRule[]>();
  for (const r of rules) m.set(groupName(r), [...(m.get(groupName(r)) ?? []), r]);
  return [...m.entries()].sort(([a], [b]) => (a === "Every network" ? 1 : b === "Every network" ? -1 : a.localeCompare(b)));
}

/** Example mode: Mark's playbook and one repeated fix waiting for his yes. Live mode: the person's own rules. */
export function PlaybookView({ mode = "example", initial = EXAMPLE, firstVisit = false, reader }: { mode?: "example" | "live"; initial?: ShownRule[]; firstVisit?: boolean; reader?: (text: string) => Promise<NewRule | null> }) {
  const live = mode === "live";
  const [rules, setRules] = useState<ShownRule[]>(live ? initial : firstVisit ? [] : EXAMPLE);
  const [offer, setOffer] = useState<"open" | "kept" | "dismissed">(live || firstVisit ? "dismissed" : "open");
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const shown = live ? initial : rules;

  const { toast } = useToastStack();
  // A deleted rule can come back: Undo adds it again with the person's own sentence and the reading it had.
  const restore = async (r: ShownRule) => {
    if (!live) return setRules((rs) => [...rs, r]);
    const res = await addRule({ kind: "guidance", text: r.text, channels: r.channels, level: r.level, reading: r });
    if (!res.ok) setProblem(res.message);
  };
  const remove = (id: string) => {
    const gone = shown.find((r) => r.id === id);
    const done = () => gone && toast({ type: "success", title: "Rule deleted", description: gone.text, duration: 10_000, action: { label: "Undo", onClick: () => void restore(gone) } });
    if (!live) { setRules((rs) => rs.filter((r) => r.id !== id)); return done(); }
    start(async () => {
      const res = await removeRule(id);
      setProblem(res.ok ? null : res.message);
      if (res.ok) done();
    });
  };
  const add = async (rule: NewRule, raw: Record<string, unknown>): Promise<string | null> => {
    if (!live) {
      setRules((rs) => [...rs, { ...rule, id: `x${rs.length + 1}`, origin: "Added by you" } as ShownRule]);
      toast({ type: "success", title: "Rule added", description: "On this example page only." });
      return null;
    }
    const res = await addRule(raw);
    if (res.ok) toast({ type: "success", title: "Rule added", description: rule.text });
    return res.ok ? null : res.message;
  };

  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <h1 className={styles.title}>{live ? (shown.length ? `Your playbook has ${shown.length} rule${shown.length === 1 ? "" : "s"}` : "Your playbook") : shown.length ? `Mark's playbook has ${shown.length} rule${shown.length === 1 ? "" : "s"}` : "Mark's first visit"}</h1>
        <p className={styles.sub}>
          {!live && firstVisit && !shown.length
            ? "No rules yet. Queue Pilot checks each draft against your rules before saving it in Buffer, so the first ones come from what you already posted."
            : live && !shown.length
            ? "No rules yet. Start from your past posts, add one below, or keep a fix you made twice when Queue Pilot offers it. Queue Pilot checks each draft against these rules before saving it in Buffer, for ChatGPT, Claude and Grok alike."
            : `Queue Pilot checks each draft against these rules before saving it in Buffer, for ChatGPT, Claude and Grok alike.${live || firstVisit ? "" : " Each came from a fix he made more than once."}`}
        </p>
      </header>

      {live && !shown.length && <FirstRulesFinder open />}
      {!live && firstVisit && <FirstRulesFinder open onExampleKeep={(o) => setRules((rs) => [...rs, { id: o.key, kind: "guidance", channels: o.channels, level: "warn", text: o.text, origin: o.proof.kind === "note" ? "From a note on your post" : `Followed in ${o.proof.followed} of your ${o.proof.of} posts` } as ShownRule])} />}

      {offer === "open" && (
        <section className={styles.offer} aria-labelledby="offer-title">
          <h2 id="offer-title" className={styles.h2}>You made the same fix twice</h2>
          <p className={styles.diff}><del><span className="sr-only">Before: </span>The soup I make on repeat</del> <span className="sr-only">After: </span>My cold-night soup.</p>
          <p className={styles.muted}>On Instagram you replaced a feeling with the dish, on Tuesday and last Friday.</p>
          <p className={styles.proposed}>Keep as a rule: "{OFFERED.text}"</p>
          <div className={styles.actions}>
            <Button variant="primary" size="sm" onClick={() => { setRules((rs) => [...rs, OFFERED]); setOffer("kept"); }}>Keep as a rule</Button>
            <Button variant="ghost" size="sm" onClick={() => setOffer("dismissed")}>Not now</Button>
          </div>
        </section>
      )}
      {offer === "kept" && <p className={styles.done} role="status">Kept. Instagram drafts now start with the dish.</p>}
      {problem && <p className={styles.problem} role="alert">{problem}</p>}

      {groups(shown).map(([name, rs]) => (
        <section key={name} className={styles.block} aria-label={`${name} rules`}>
          <h2 className={styles.h2}>{name}</h2>
          <ul className={styles.rows}>
            {rs.map((r) => {
              const hold = ruleHold(r);
              return (
                <li key={r.id} className={styles.row}>
                  <span className={styles.text}>
                    <strong>{r.text}</strong>
                    <span className={styles.muted}>{HOLD_HINT[hold]}{r.origin ? `. ${r.origin}.` : "."}</span>
                  </span>
                  <span className={styles.rowEnd}>
                    <Badge tone={HOLD_TONE[hold]} size="sm">{hold}</Badge>
                    <ConfirmButton label="Delete" ariaLabel={`Delete rule: ${r.text}`} question="Delete this rule?" confirmLabel="Delete rule" onConfirm={() => remove(r.id)} />
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      {/* Adding sits right under the rules it adds to; finding and trying rules come after. */}
      <RuleForm onAdd={add} read={reader ?? (live ? readRule : undefined)} />
      {live && shown.length > 0 && <FirstRulesFinder />}
      {live && <RewriteFinder />}
      {!firstVisit && <RuleTester live={live} example={EXAMPLE_TRY} />}

      <section className={styles.checksBlock} aria-labelledby="checks-title">
        <h2 id="checks-title" className={styles.checksTitle}>Every draft is also checked for</h2>
        <p className={styles.muted}>Your rules above are judged by meaning, in any language, by a model. These four run on every draft too, before it is saved in Buffer.</p>
        <ul className={styles.checks}>
          {DRAFT_CHECKS.map((c) => (
            <li key={c.name}><strong>{c.name}</strong><span className={styles.muted}>{c.note}</span></li>
          ))}
        </ul>
      </section>
    </div>
  );
}
