"use client";

import { RuleRouting, type RuleAccount } from "./rule-routing";
import type { Inheritance } from "@/lib/rule-scopes";
import { DRAFT_CHECKS } from "@/lib/draft-checks";

import { useEffect, useState, useTransition } from "react";
import { PAGE_ACTION_EVENT } from "./keyboard-shortcuts";
import { addRule, readRule, removeRule, setRuleException } from "@/app/(app)/actions";
import { Badge } from "@/registry/components/badge/badge";
import { Button } from "@/registry/components/button/button";
import { appliesTo, NETWORKS, ruleHold, type NewRule, type Rule } from "@/lib/rules";
import { EXAMPLE_RULES } from "@/lib/example-playbook";
import { EXAMPLE_TRY } from "@/lib/example-verdicts";
import { useToastStack } from "@/registry/components/toast-stack/toast-stack";
import { ConfirmButton } from "./confirm-button";
import { RuleForm } from "./rule-form";
import { FirstRulesFinder } from "./first-rules-finder";
import { RewriteFinder } from "./rewrite-finder";
import { RuleTester } from "./rule-tester";
import { TeamNotesFinder } from "./team-notes-finder";
import { EXAMPLE_NOTE_RULE } from "@/lib/example-notes";
import styles from "./playbook-view.module.css";

/** A rule as the Playbook shows it: the rule, and the edits it came from when there were any. */
export type ShownRule = Rule & { origin?: string };

function reviewEvidence(value: unknown): { comment: string; reason: string } | null {
  if (!value || typeof value !== "object") return null;
  const e = value as Record<string, unknown>;
  return e.kind === "review" && typeof e.comment === "string" && typeof e.reason === "string" ? { comment: e.comment, reason: e.reason } : null;
}

const EXAMPLE: ShownRule[] = EXAMPLE_RULES;
const OFFERED: ShownRule = { id: "r5", kind: "guidance", channels: ["instagram"], level: "warn", text: "Start with the result, not a feeling.", origin: "You changed the opening in 2 drafts" };
const HOLD_TONE = { "Blocks drafts": "danger", "Flags drafts": "warning" } as const;
const HOLD_HINT = { "Blocks drafts": "A draft that breaks it is rewritten once, then not saved", "Flags drafts": "A draft that breaks it is saved and flagged for you" };

const EXAMPLE_NETWORKS = ["twitter", "linkedin", "instagram"];

const groupName = (r: Rule, accounts: RuleAccount[]) => (r.accountIds?.length ? r.accountIds.map(id => accounts.find(a => a.id === id)?.name ?? "Disconnected account").join(", ") : r.channels === "all" ? "Every network" : r.channels.map((c) => NETWORKS[c] ?? c).join(", "));

function groups(rules: ShownRule[], accounts: RuleAccount[]): [string, ShownRule[]][] {
  const m = new Map<string, ShownRule[]>();
  for (const r of rules) m.set(groupName(r, accounts), [...(m.get(groupName(r, accounts)) ?? []), r]);
  return [...m.entries()].sort(([a], [b]) => (a === "Every network" ? 1 : b === "Every network" ? -1 : a.localeCompare(b)));
}

/** Example mode: Alex's playbook and one repeated fix waiting for Alex's yes. Live mode: the person's own rules. */
export function PlaybookView({ mode = "example", initial = EXAMPLE, firstVisit = false, reader, networks = EXAMPLE_NETWORKS, accounts = [], inheritance = {} }: { mode?: "example" | "live"; initial?: ShownRule[]; firstVisit?: boolean; reader?: (text: string) => Promise<NewRule | null>; networks?: string[]; accounts?: RuleAccount[]; inheritance?: Inheritance }) {
  const live = mode === "live";
  // Networks a shared rule was switched off for on this screen, ahead of the server's answer.
  const [except, setExcept] = useState<Record<string, string[]>>({});
  const [rules, setRules] = useState<ShownRule[]>(live ? initial : firstVisit ? [] : EXAMPLE);
  const [offer, setOffer] = useState<"open" | "kept" | "dismissed">(live || firstVisit ? "dismissed" : "open");
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const shown = (live ? initial : rules).map((r) => (except[r.id] ? { ...r, except: except[r.id] } : r));
  const toggle = (r: ShownRule, network: string) => {
    const off = !(r.except ?? []).includes(network);
    const next = off ? [...(r.except ?? []), network] : (r.except ?? []).filter((n) => n !== network);
    const before = r.except ?? [];
    setExcept((e) => ({ ...e, [r.id]: next }));
    if (!live) return;
    start(async () => {
      const res = await setRuleException(r.id, network, off);
      if (!res.ok) { setExcept((e) => ({ ...e, [r.id]: before })); setProblem(res.message); }
    });
  };

  const { toast } = useToastStack();
  // "Add a rule" from the palette or the + Rule button: bring the form into view and put the cursor in it.
  const focusAdd = () => { const f = document.getElementById("add-rule"); f?.scrollIntoView({ behavior: "smooth", block: "center" }); f?.querySelector<HTMLElement>("textarea, input")?.focus({ preventScroll: true }); };
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("do") === "add-rule") { window.history.replaceState(null, "", window.location.pathname); focusAdd(); }
    const on = (e: Event) => { if ((e as CustomEvent).detail === "add-rule") focusAdd(); };
    window.addEventListener(PAGE_ACTION_EVENT, on);
    return () => window.removeEventListener(PAGE_ACTION_EVENT, on);
  }, []);
  // A deleted rule can come back: Undo adds it again with the person's own sentence and the reading it had.
  const restore = async (r: ShownRule) => {
    if (!live) return setRules((rs) => [...rs, r]);
    const res = await addRule({ kind: "guidance", text: r.text, channels: r.channels, accountIds: r.accountIds, except: r.except, overrides: r.overrides, level: r.level, reading: r });
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
    // The form's button confirms on itself, so no toast here.
    const res = await addRule(raw);
    return res.ok ? null : res.message;
  };

  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <h1 className={styles.title}>{live ? (shown.length ? <>Playbook <span className={styles.count}>{shown.length} rule{shown.length === 1 ? "" : "s"}</span></> : "Your playbook") : shown.length ? `Alex's playbook has ${shown.length} rule${shown.length === 1 ? "" : "s"}` : "Alex's first visit"}</h1>
        <p className={styles.sub}>
          {!live && firstVisit && !shown.length
            ? "No rules yet. Queue Pilot checks each draft against your rules before saving it in Buffer, so the first ones come from what you already posted."
            : live && !shown.length
            ? "No rules yet. Start from your past posts, add one below, or keep a fix you made twice when Queue Pilot offers it. Queue Pilot checks each draft against these rules before saving it in Buffer, for ChatGPT, Claude and Grok alike."
            : accounts.length ? "Pick an account to see what applies there. What you changed for it comes first." : `Queue Pilot checks each draft against these rules before saving it in Buffer, for ChatGPT, Claude and Grok alike.${live || firstVisit ? "" : " Each came from a fix Alex made more than once."}`}
        </p>
      </header>

      {live && !shown.length && <FirstRulesFinder open />}
      {!live && firstVisit && <FirstRulesFinder open onExampleKeep={(o) => setRules((rs) => [...rs, { id: o.key, kind: "guidance", channels: o.channels, level: "warn", text: o.text, origin: o.proof.kind === "note" ? "From a note on your post" : `Followed in ${o.proof.followed} of your ${o.proof.of} posts` } as ShownRule])} />}

      {offer === "open" && (
        <section className={styles.offer} aria-labelledby="offer-title">
          <h2 id="offer-title" className={styles.h2}>You made the same fix twice</h2>
          <p className={styles.diff}><del><span className="sr-only">Before: </span>This week felt like a turning point for coding agents.</del> <span className="sr-only">After: </span>Android Studio now lets you pick from over 40 coding agents.</p>
          <p className={styles.muted}>On Instagram you replaced a feeling with the result, on Tuesday and last Friday.</p>
          <p className={styles.proposed}>Keep as a rule: "{OFFERED.text}"</p>
          <div className={styles.actions}>
            <Button variant="primary" size="sm" onClick={() => { setRules((rs) => [...rs, OFFERED]); setOffer("kept"); }}>Keep as a rule</Button>
            <Button variant="ghost" size="sm" onClick={() => setOffer("dismissed")}>Not now</Button>
          </div>
        </section>
      )}
      {offer === "kept" && <p className={styles.done} role="status">Kept. Instagram drafts now start with the result.</p>}
      {(live || !firstVisit) && <TeamNotesFinder example={!live} onExampleKeep={() => setRules((rs) => (rs.some((r) => r.id === EXAMPLE_NOTE_RULE.id) ? rs : [...rs, EXAMPLE_NOTE_RULE]))} />}
      {problem && <p className={styles.problem} role="alert">{problem}</p>}

      {accounts.length > 0 && <RuleRouting rules={shown} accounts={accounts} inheritance={inheritance} onDelete={(r) => remove(r.id)} onAdd={focusAdd} example={!live} />}
      {networks.length > 1 && shown.length > 0 && !accounts.length && (
        <p className={styles.muted} aria-label="Rules by network">
          {networks.map((n) => `${NETWORKS[n] ?? n}: ${shown.filter((r) => appliesTo(r, n)).length} rule${shown.filter((r) => appliesTo(r, n)).length === 1 ? "" : "s"}`).join(" · ")}
        </p>
      )}
      {!accounts.length && groups(shown, accounts).map(([name, rs]) => (
        <section key={name} className={styles.block} aria-label={`${name} rules`}>
          <h2 className={styles.h2}>{name}</h2>
          <ul className={styles.rows}>
            {rs.map((r) => {
              const hold = ruleHold(r);
              const evidence = reviewEvidence(r.learnedFrom);
              return (
                <li key={r.id} className={styles.row}>
                  <span className={styles.text}>
                    <strong>{r.text}</strong>
                    <span className={styles.muted}>{HOLD_HINT[hold]}{evidence ? ". Kept from review feedback." : r.origin ? `. ${r.origin}.` : "."}</span>
                    {evidence && <details><summary>Why this became a rule</summary><blockquote className={styles.quote}>{evidence.comment}</blockquote><p className={styles.muted}>{evidence.reason}</p></details>}
                    {!live && r.channels === "all" && networks.length > 0 && (
                      <span className={styles.nets} role="group" aria-label={`Networks for: ${r.text}`}>
                        {networks.map((n) => {
                          const on = appliesTo(r, n);
                          return (
                            <button key={n} type="button" className={styles.net} aria-pressed={on} disabled={pending} onClick={() => toggle(r, n)} title={on ? `On for ${NETWORKS[n] ?? n}. Switch it off there.` : `Off for ${NETWORKS[n] ?? n}. Switch it back on.`}>
                              {NETWORKS[n] ?? n}{on ? "" : " off"}
                            </button>
                          );
                        })}
                      </span>
                    )}
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
      <div id="add-rule"><RuleForm accounts={accounts} onAdd={add} read={reader ?? (live ? readRule : undefined)} /></div>
      {live && shown.length > 0 && <FirstRulesFinder />}
      {live && <RewriteFinder />}
      {!firstVisit && <RuleTester live={live} example={EXAMPLE_TRY} accounts={accounts} />}

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
