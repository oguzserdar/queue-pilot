"use client";

import { RuleRouting, type RuleAccount } from "./rule-routing";
import type { Inheritance } from "@/lib/rule-scopes";
import { DRAFT_CHECKS } from "@/lib/draft-checks";

import { useEffect, useId, useState, useTransition, type ComponentProps } from "react";
import { PAGE_ACTION_EVENT } from "./keyboard-shortcuts";
import { addRule, readRule, removeRule, setRuleException } from "@/app/(app)/rule-actions";
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
import { RepeatedFixes } from "./repeated-fixes";
import type { RepeatedFixesResult } from "@/app/(app)/fix-actions";
import { RuleTester } from "./rule-tester";
import { TeamNotesFinder } from "./team-notes-finder";
import { exampleNoteRule } from "@/lib/example-notes";
import { ownRules } from "@/lib/rule-origin";
import styles from "./playbook-view.module.css";

/** A rule as the Playbook shows it: the rule, and the edits it came from when there were any. */
export type ShownRule = Rule & { origin?: string };

/** A rule that came from a review comment: the comment and the reason, from its record. */
function reviewEvidence(value: unknown): { comment: string; reason: string } | null {
  if (!value || typeof value !== "object") return null;
  if (!("kind" in value) || value.kind !== "review" || !("comment" in value) || !("reason" in value)) return null;
  return typeof value.comment === "string" && typeof value.reason === "string" ? { comment: value.comment, reason: value.reason } : null;
}

const EXAMPLE: ShownRule[] = EXAMPLE_RULES;
const OFFERED: ShownRule = { id: "r5", kind: "guidance", channels: ["instagram"], level: "warn", text: "Start with the result, not a feeling.", origin: "You changed the opening in 2 drafts" };
const HOLD_TONE = { "Blocks drafts": "danger", "Flags drafts": "warning" } as const;
const HOLD_HINT = { "Blocks drafts": "A draft that breaks it is rewritten once, then not saved", "Flags drafts": "A draft that breaks it is saved and flagged for you" };

const EXAMPLE_NETWORKS = ["twitter", "linkedin", "instagram"];

/** The one plain line that explains the starting rule while it is the only rule in the playbook. */
export const STARTING_RULE_LINE = "Queue Pilot starts you with one rule that keeps private matters out of your posts. Remove it any time, or add your own wording below.";

/** The heading a rule is listed under: its accounts by name, every network, or its networks. */
function groupName(r: Rule, accounts: RuleAccount[]): string {
  if (r.accountIds?.length) return r.accountIds.map(id => accounts.find(a => a.id === id)?.name ?? "Disconnected account").join(", ");
  if (r.channels === "all") return "Every network";
  return r.channels.map((c) => NETWORKS[c] ?? c).join(", ");
}

/** Headings in name order, with "Every network" last. */
function byGroupName(a: string, b: string): number {
  if (a === "Every network") return 1;
  return b === "Every network" ? -1 : a.localeCompare(b);
}

function groups(rules: ShownRule[], accounts: RuleAccount[]): [string, ShownRule[]][] {
  const m = new Map<string, ShownRule[]>();
  for (const r of rules) m.set(groupName(r, accounts), [...(m.get(groupName(r, accounts)) ?? []), r]);
  return [...m.entries()].sort(([a], [b]) => byGroupName(a, b));
}

/** What the same-fix offer says: the edit, where it happened, and the rule it would keep. */
export type SameFixContent = {
  title: string;
  /** The words before and after the person's edit. */
  before: string;
  after: string;
  /** Where and when the fix was made, in one sentence. */
  where: string;
  /** The rule as it will read in the playbook. */
  rule: string;
  /** Why the model judged it a lasting preference, when it said. */
  why?: string;
  /** The live edit split around the change, so the cut words are struck and the added words marked in one line. */
  change?: { lead: string; removed: string; added: string; tail: string };
};

/** Alex's repeated fix, as the example playbook, the homepage and the demo show it. */
export const EXAMPLE_SAME_FIX: SameFixContent = {
  title: "You made the same fix twice",
  before: "This week felt like a turning point for coding agents.",
  after: "Android Studio now lets you pick from over 40 coding agents.",
  where: "On Instagram you replaced a feeling with the result, on Tuesday and last Friday.",
  rule: OFFERED.text,
};

/**
 * The offer shown after the same fix is made twice: the edit, where it happened, and the rule it would keep. Drawn by
 * the live playbook with the person's own edit, and with {@link EXAMPLE_SAME_FIX} by the example and the homepage.
 */
export function SameFixOffer({ content, onKeep, onDismiss, pending = false }: { content: SameFixContent; onKeep?: () => void; onDismiss?: () => void; /** While Keep or Not now is saving. */ pending?: boolean }) {
  const titleId = useId();
  return (
    <section className={styles.offer} aria-labelledby={titleId}>
      <h2 id={titleId} className={styles.h2}>{content.title}</h2>
      {content.change ? (
        <p className={styles.diff}>
          {content.change.lead}{content.change.removed && <> <del><span className="sr-only">Cut: </span>{content.change.removed}</del></>}{content.change.added && <> <ins><span className="sr-only">Added: </span>{content.change.added}</ins></>}{content.change.tail && ` ${content.change.tail}`}
        </p>
      ) : (
        <p className={styles.diff}><del><span className="sr-only">Before: </span>{content.before}</del> <span className="sr-only">After: </span>{content.after}</p>
      )}
      <p className={styles.muted}>{content.where}</p>
      {content.why && <p className={styles.why}>{content.why}</p>}
      {/* A rule that already quotes its words ("End with "…"") is shown as it is, never inside a second pair of quotes. */}
      <p className={styles.proposed}>Keep as a rule: {content.rule.includes('"') ? content.rule : `"${content.rule}"`}</p>
      <div className={styles.actions}>
        <Button variant="primary" size="sm" disabled={pending} onClick={onKeep}>Keep as a rule</Button>
        <Button variant="ghost" size="sm" disabled={pending} onClick={onDismiss}>Not now</Button>
      </div>
    </section>
  );
}

/** The rules the page starts with: the person's own when live, none on a first visit, else Alex's. */
function startingRules(live: boolean, firstVisit: boolean, initial: ShownRule[]): ShownRule[] {
  if (live) return initial;
  return firstVisit ? [] : EXAMPLE;
}

/** A first rule kept from the example finder, with the proof it was offered with. */
function ruleFromOffer(o: Parameters<NonNullable<ComponentProps<typeof FirstRulesFinder>["onExampleKeep"]>>[0]): ShownRule {
  return { id: o.key, kind: "guidance", channels: o.channels, level: "warn", text: o.text, origin: o.proof.kind === "note" ? "From a note on your post" : `Followed in ${o.proof.followed} of your ${o.proof.of} posts` };
}

/** The page title: the count of the person's rules, or Alex's, or the first visit. */
function PlaybookTitle({ live, count }: { live: boolean; count: number }) {
  if (live) return <h1 className={styles.title}>{count ? <>Playbook <span className={styles.count}>{count} rule{count === 1 ? "" : "s"}</span></> : "Your playbook"}</h1>;
  return <h1 className={styles.title}>{count ? `Alex's playbook: ${count} rule${count === 1 ? "" : "s"} across 4 accounts` : "Alex's first visit"}</h1>;
}

/** The line under the title: how to get first rules while there are none, else what the rules are for. */
function introLine(p: { live: boolean; firstVisit: boolean; count: number; startingOnly: boolean; routed: boolean }): string {
  if (!p.live && p.firstVisit && !p.count) return "No rules yet. Queue Pilot checks each draft against your rules before saving it in Buffer, so the first ones come from what you already posted.";
  if (p.live && !p.count) return "No rules yet. Start from your past posts, add one below, or keep a fix you made twice when Queue Pilot offers it. Queue Pilot checks each draft against these rules before saving it in Buffer, for ChatGPT, Claude and Grok alike.";
  if (p.startingOnly) return `No rules of your own yet. Start from your past posts, add one below, or keep a fix you made twice when Queue Pilot offers it. ${STARTING_RULE_LINE}`;
  if (p.routed) return "Pick an account to see what applies there. What you changed for it comes first.";
  return `Queue Pilot checks each draft against these rules before saving it in Buffer, for ChatGPT, Claude and Grok alike.${p.live || p.firstVisit ? "" : " Each came from a fix Alex made more than once."}`;
}

/** How many rules apply on each network. */
function NetworkCounts({ networks, rules }: { networks: string[]; rules: ShownRule[] }) {
  return (
    <p className={styles.muted} aria-label="Rules by network">
      {networks.map((n) => `${NETWORKS[n] ?? n}: ${rules.filter((r) => appliesTo(r, n)).length} rule${rules.filter((r) => appliesTo(r, n)).length === 1 ? "" : "s"}`).join(" · ")}
    </p>
  );
}

/** Where a rule came from, after its hold: review feedback, its recorded origin, or nothing more. */
function originNote(evidence: boolean, origin: string | undefined): string {
  if (evidence) return ". Kept from review feedback.";
  return origin ? `. ${origin}.` : ".";
}

/** An every-network rule's switches, one per network (example only): on, or off for that network. */
function NetworkToggles({ r, networks, pending, onToggle }: { r: ShownRule; networks: string[]; pending: boolean; onToggle: (r: ShownRule, network: string) => void }) {
  return (
    <span className={styles.nets} role="group" aria-label={`Networks for: ${r.text}`}>
      {networks.map((n) => {
        const on = appliesTo(r, n);
        return (
          <button key={n} type="button" className={styles.net} aria-pressed={on} disabled={pending} onClick={() => onToggle(r, n)} title={on ? `On for ${NETWORKS[n] ?? n}. Switch it off there.` : `Off for ${NETWORKS[n] ?? n}. Switch it back on.`}>
            {NETWORKS[n] ?? n}{on ? "" : " off"}
          </button>
        );
      })}
    </span>
  );
}

/** One heading's rules: each with how it holds a draft, where it came from, and Delete. */
function RuleGroup({ name, rules, networks, pending, onToggle, onDelete }: { name: string; rules: ShownRule[]; networks: string[]; pending: boolean; onToggle: (r: ShownRule, network: string) => void; onDelete: (id: string) => void }) {
  return (
    <section className={styles.block} aria-label={`${name} rules`}>
      <h2 className={styles.h2}>{name}</h2>
      <ul className={styles.rows}>
        {rules.map((r) => {
          const hold = ruleHold(r);
          const evidence = reviewEvidence(r.learnedFrom);
          return (
            <li key={r.id} className={styles.row}>
              <span className={styles.text}>
                <strong>{r.text}</strong>
                <span className={styles.muted}>{HOLD_HINT[hold]}{originNote(evidence !== null, r.origin)}</span>
                {evidence && <details><summary>Why this became a rule</summary><blockquote className={styles.quote}>{evidence.comment}</blockquote><p className={styles.muted}>{evidence.reason}</p></details>}
                {r.channels === "all" && networks.length > 0 && <NetworkToggles r={r} networks={networks} pending={pending} onToggle={onToggle} />}
              </span>
              <span className={styles.rowEnd}>
                <Badge tone={HOLD_TONE[hold]} size="sm">{hold}</Badge>
                <ConfirmButton label="Delete" ariaLabel={`Delete rule: ${r.text}`} question="Delete this rule?" confirmLabel="Delete rule" onConfirm={() => onDelete(r.id)} />
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Finding first rules: open at the top while the person has none of their own, or on the example's first visit. */
function FirstFinder({ live, hasOwn, firstVisit, onExampleKeep }: { live: boolean; hasOwn: boolean; firstVisit: boolean; onExampleKeep: NonNullable<ComponentProps<typeof FirstRulesFinder>["onExampleKeep"]> }) {
  if (live) return hasOwn ? null : <FirstRulesFinder open />;
  return firstVisit ? <FirstRulesFinder open onExampleKeep={onExampleKeep} /> : null;
}

/** The example's same-fix offer, or the line that confirms it was kept. */
function ExampleOffer({ offer, onKeep, onDismiss }: { offer: "open" | "kept" | "dismissed"; onKeep: () => void; onDismiss: () => void }) {
  if (offer === "open") return <SameFixOffer content={EXAMPLE_SAME_FIX} onKeep={onKeep} onDismiss={onDismiss} />;
  return offer === "kept" ? <p className={styles.done} role="status">Kept. Instagram drafts now start with the result.</p> : null;
}

/** Below the form: more ways to find rules once there are some, rewrites, and trying a draft. */
function MoreFinders({ live, hasOwn, firstVisit, accounts }: { live: boolean; hasOwn: boolean; firstVisit: boolean; accounts: RuleAccount[] }) {
  return (
    <>
      {live && hasOwn && <FirstRulesFinder />}
      {live && <RewriteFinder />}
      {!firstVisit && <RuleTester live={live} example={EXAMPLE_TRY} accounts={accounts} />}
    </>
  );
}

/**
 * The rules: by account, through the routing view, when the person has accounts; otherwise grouped by where they
 * apply, with a count per network.
 */
function RuleList({ rules, live, networks, accounts, inheritance, pending, onToggle, onDelete, onAdd }: {
  rules: ShownRule[];
  live: boolean;
  networks: string[];
  accounts: RuleAccount[];
  inheritance: Inheritance;
  pending: boolean;
  onToggle: (r: ShownRule, network: string) => void;
  onDelete: (id: string) => void;
  onAdd: () => void;
}) {
  if (accounts.length > 0) return <RuleRouting rules={rules} accounts={accounts} inheritance={inheritance} onDelete={(r) => onDelete(r.id)} onAdd={onAdd} example={!live} />;
  return (
    <>
      {networks.length > 1 && rules.length > 0 && <NetworkCounts networks={networks} rules={rules} />}
      {groups(rules, accounts).map(([name, rs]) => (
        <RuleGroup key={name} name={name} rules={rs} networks={live ? [] : networks} pending={pending} onToggle={onToggle} onDelete={onDelete} />
      ))}
    </>
  );
}

/** The four checks every draft gets besides the rules. */
function ChecksBlock() {
  return (
    <section className={styles.checksBlock} aria-labelledby="checks-title">
      <h2 id="checks-title" className={styles.checksTitle}>Every draft is also checked for</h2>
      <p className={styles.muted}>Your rules above are judged by meaning, in any language, by a model. These four run on every draft too, before it is saved in Buffer.</p>
      <ul className={styles.checks}>
        {DRAFT_CHECKS.map((c) => (
          <li key={c.name}><strong>{c.name}</strong><span className={styles.muted}>{c.note}</span></li>
        ))}
      </ul>
    </section>
  );
}

/** Example mode: Alex's playbook and one repeated fix waiting for Alex's yes. Live mode: the person's own rules. */
export function PlaybookView({ mode = "example", initial = EXAMPLE, firstVisit = false, reader, networks = EXAMPLE_NETWORKS, accounts = [], inheritance = {}, demoShift = 0, repeats, fixesPreview }: { mode?: "example" | "live"; /** Live: open repeated fixes found without AI, and the drafts the first was made in. */ repeats?: { count: number; edits: number }; /** Development screens only: the offer's answer, drawn without the server. */ fixesPreview?: RepeatedFixesResult | "reading"; initial?: ShownRule[]; firstVisit?: boolean; reader?: (text: string) => Promise<NewRule | null>; networks?: string[]; accounts?: RuleAccount[]; inheritance?: Inheritance; /** Days the example note moves with the example week (demoShiftDays() from the page). */ demoShift?: number }) {
  const live = mode === "live";
  // Networks a shared rule was switched off for on this screen, ahead of the server's answer.
  const [except, setExcept] = useState<Record<string, string[]>>({});
  const [rules, setRules] = useState<ShownRule[]>(() => startingRules(live, firstVisit, initial));
  const [offer, setOffer] = useState<"open" | "kept" | "dismissed">(() => (live || firstVisit ? "dismissed" : "open"));
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, start] = useTransition();
  // Kept once shown: keeping the rule clears the repeat on the server, and the confirmation stays on screen.
  const [fixes] = useState(() => (live && !!repeats?.count ? repeats : null));
  const shown = (live ? initial : rules).map((r) => (except[r.id] ? { ...r, except: except[r.id] } : r));
  // The starting rule Queue Pilot gave the account is checked like any rule, but it is not one of the person's own: with
  // only it, the page still invites them to find their first rules.
  const own = ownRules(shown);
  const startingOnly = live && shown.length > 0 && !own.length;
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
    const on = (e: Event) => { if (e instanceof CustomEvent && e.detail === "add-rule") focusAdd(); };
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
      setRules((rs) => [...rs, { ...rule, id: `x${rs.length + 1}`, origin: "Added by you" }]);
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
        <PlaybookTitle live={live} count={shown.length} />
        <p className={styles.sub}>{introLine({ live, firstVisit, count: shown.length, startingOnly, routed: accounts.length > 0 })}</p>
      </header>

      {fixes && <RepeatedFixes repeats={fixes.count} edits={fixes.edits} preview={fixesPreview} />}
      <FirstFinder live={live} hasOwn={own.length > 0} firstVisit={firstVisit} onExampleKeep={(o) => setRules((rs) => [...rs, ruleFromOffer(o)])} />

      <ExampleOffer offer={offer} onKeep={() => { setRules((rs) => [...rs, OFFERED]); setOffer("kept"); }} onDismiss={() => setOffer("dismissed")} />
      {(live || !firstVisit) && <TeamNotesFinder example={!live} shift={demoShift} onExampleKeep={() => setRules((rs) => { const rule = exampleNoteRule(demoShift); return rs.some((r) => r.id === rule.id) ? rs : [...rs, rule]; })} />}
      {problem && <p className={styles.problem} role="alert">{problem}</p>}

      <RuleList rules={shown} live={live} networks={networks} accounts={accounts} inheritance={inheritance} pending={pending} onToggle={toggle} onDelete={remove} onAdd={focusAdd} />

      {/* Adding sits right under the rules it adds to; finding and trying rules come after. */}
      <div id="add-rule"><RuleForm accounts={accounts} onAdd={add} read={reader ?? (live ? readRule : undefined)} /></div>
      <MoreFinders live={live} hasOwn={own.length > 0} firstVisit={firstVisit} accounts={accounts} />

      <ChecksBlock />
    </div>
  );
}
