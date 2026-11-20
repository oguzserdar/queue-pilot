"use client";
import { useState, useTransition } from "react";
import { changeInheritance, changeRuleOverride } from "@/app/(app)/review-actions";
import { resolveRule, type Inheritance } from "@/lib/rule-scopes";
import { NETWORKS, type Rule } from "@/lib/rules";
import { isStartingRule, STARTING_RULE_ORIGIN } from "@/lib/rule-origin";
import { Badge } from "@/registry/components/badge/badge";
import { Button } from "@/registry/components/button/button";
import { Select } from "@/registry/components/select/select";
import { Switch } from "@/registry/components/switch/switch";
import { useToastStack } from "@/registry/components/toast-stack/toast-stack";
import { ConfirmButton } from "./confirm-button";
import { Term } from "./term";
import styles from "./rule-routing.module.css";

export type RuleAccount = { id: string; name: string; service: string };
type Level = "shared" | "network" | "account";
type Use = { shared: boolean; network: boolean };
type Saved = { ok?: boolean; message?: string } | undefined;

/**
 * Rules for each account: pick an account (or every account on a network), see its rules grouped by where they come
 * from, switch one off or back on here, or stop using a whole level after seeing exactly which rules that changes.
 */
const EXAMPLE_NOTE = "This is the example account. Sign in with Buffer to change where your own rules apply.";

/** Where a rule was set: for one account, for a network, or for every account. */
const ruleOrigin = (r: Rule): Level => {
  if (r.accountIds?.length) return "account";
  return r.channels === "all" ? "shared" : "network";
};

/** Where a rule was set, in words: every account, its networks, or its accounts by name. */
function ruleSource(r: Rule, accounts: RuleAccount[]): string {
  if (r.accountIds?.length) return r.accountIds.map(a => accounts.find(x => x.id === a)?.name ?? "Disconnected account").join(", ");
  if (r.channels === "all") return "All accounts";
  return r.channels.map(c => NETWORKS[c] ?? c).join(", ");
}

/** A rule that came from a review comment: the comment and the reason, from its record. */
function review(value: unknown): { comment: string; reason: string } | null {
  if (!value || typeof value !== "object") return null;
  if (!("kind" in value) || value.kind !== "review" || !("comment" in value) || !("reason" in value)) return null;
  return typeof value.comment === "string" && typeof value.reason === "string" ? { comment: value.comment, reason: value.reason } : null;
}

/** The picked target ("account:<id>", "network:<id>" or "all"), resolved to what the screen talks about. */
function targetOf(target: string, accounts: RuleAccount[]) {
  const all = target === "all";
  const level: "account" | "network" = target.startsWith("account:") ? "account" : "network";
  const id = target.slice(target.indexOf(":") + 1);
  const account = accounts.find(a => a.id === id);
  const network = level === "network" ? id : account?.service ?? "";
  const net = NETWORKS[network] ?? network;
  const where = level === "account" ? account?.name ?? "this account" : `every ${net} account`;
  return { all, level, id, account, network, net, where };
}
type Target = ReturnType<typeof targetOf>;

/** Which inherited levels the target uses now: a network uses its shared rules unless off; an account both. */
function currentUse(t: Target, inheritance: Inheritance): Use {
  if (t.level === "network") return { shared: inheritance.networks?.[t.id]?.shared !== false, network: true };
  return { shared: inheritance.accounts?.[t.id]?.shared !== false, network: inheritance.accounts?.[t.id]?.network !== false };
}

/** The inheritance with the target's levels set as previewed. */
function proposedInheritance(t: Target, inheritance: Inheritance, next: Use): Inheritance {
  if (t.level === "network") return { ...inheritance, networks: { ...inheritance.networks, [t.id]: { shared: next.shared } } };
  return { ...inheritance, accounts: { ...inheritance.accounts, [t.id]: next } };
}

/** A rule's own switch for the target: on, off, or undefined when it follows the level it comes from. */
function overrideOf(r: Rule, t: Target): boolean | undefined {
  if (t.level === "account") return r.overrides?.accounts?.[t.id];
  return r.overrides?.networks?.[t.id] ?? (r.except?.includes(t.id) ? false : undefined);
}

/** Only the rules that concern this account or network; another account's own rules are none of its business. */
function rulesFor(rules: Rule[], t: Target): Rule[] {
  if (t.all) return rules;
  return rules.filter(r => (r.accountIds?.length ? t.level === "account" && r.accountIds.includes(t.id) : r.channels === "all" || r.channels.includes(t.network)));
}

/** Each rule once: what was changed here first, then this account's own, then what it inherits. */
function groupsFor(mine: Rule[], t: Target): { key: string; title: string; rules: Rule[] }[] {
  if (t.all) return [{ key: "all", title: "Every rule", rules: mine }];
  return [
    { key: "changed", title: `Changed for ${t.level === "account" ? "this account" : t.where}`, rules: mine.filter(r => ruleOrigin(r) !== "account" && overrideOf(r, t) !== undefined) },
    { key: "own", title: "This account's own", rules: mine.filter(r => ruleOrigin(r) === "account") },
    { key: "inherited", title: "Also applies here", rules: mine.filter(r => ruleOrigin(r) !== "account" && overrideOf(r, t) === undefined) },
  ].filter(g => g.rules.length > 0 || g.key === "inherited");
}

/** Everything a rule row needs to know about the screen it is on. */
type RowContext = {
  t: Target;
  accounts: RuleAccount[];
  inheritance: Inheritance;
  current: Use;
  /** An account inherits shared rules only when both it and its network do (the same boundary resolveRule applies). */
  netShared: boolean;
  pending: boolean;
  onTurnOff: (r: Rule) => void;
  onSet: (r: Rule, on: boolean | null, done: string) => void;
  onDelete: (r: Rule) => void;
};

/** Whether the target uses the level a rule comes from. */
function usedHere(r: Rule, c: RowContext): boolean {
  const origin = ruleOrigin(r);
  if (origin === "shared") return c.current.shared && c.netShared;
  return origin === "network" ? c.current.network : true;
}

/** Why a rule is off here, or that it was switched on or off here; nothing when it simply applies. */
function RuleState({ r, c, on, applies, override }: { r: Rule; c: RowContext; on: boolean; applies: boolean; override: boolean | undefined }) {
  if (c.t.all) return null;
  if (!on) return <span className={styles.warn}>{ruleOrigin(r) === "shared" && !c.netShared ? `All-account rules are off for every ${c.t.net} account` : "Set not used here"}</span>;
  if (override === false) return <span className={styles.warn}>Off here</span>;
  if (override === true) return <span>On here</span>;
  return applies ? null : <span className={styles.warn}>{`Off for every ${c.t.net} account`}</span>;
}

/** What can be done with a rule here: turn it off or on for the target, reset it, or delete it. */
function RuleActions({ r, c, on, applies, override }: { r: Rule; c: RowContext; on: boolean; applies: boolean; override: boolean | undefined }) {
  const { t, pending } = c;
  const canChange = !t.all && on && ruleOrigin(r) !== "account" && (t.level === "account" || ruleOrigin(r) === "shared");
  return (
    <div className={styles.ruleActions}>
      {canChange && override === undefined && applies && <Button variant="ghost" size="sm" disabled={pending} onClick={() => c.onTurnOff(r)}>Turn off here</Button>}
      {canChange && override === undefined && !applies && t.level === "account" && <Button variant="ghost" size="sm" disabled={pending} onClick={() => c.onSet(r, true, `Turned on for ${t.where}.`)}>Turn on here</Button>}
      {canChange && override !== undefined && <Button variant="ghost" size="sm" disabled={pending} onClick={() => c.onSet(r, null, "Back to the setting it follows.")}>Reset</Button>}
      {(t.all || ruleOrigin(r) === "account") && <ConfirmButton label="Delete" ariaLabel={`Delete rule: ${r.text}`} question="Delete this rule?" confirmLabel="Delete rule" onConfirm={() => c.onDelete(r)} />}
    </div>
  );
}

/** One rule: its text, where it was set, how strict it is, where it came from, and whether it applies here. */
function RuleRow({ r, c }: { r: Rule; c: RowContext }) {
  const on = usedHere(r, c);
  const applies = resolveRule({ ...r, inheritance: c.inheritance }, c.t.network, c.t.account?.id).applies;
  const override = c.t.all ? undefined : overrideOf(r, c.t);
  const evidence = review(r.learnedFrom);
  return (
    <li className={styles.rule} data-off={!c.t.all && (!on || !applies)}>
      <div className={styles.ruleMain}>
        <span className={styles.ruleText}>{r.text}</span>
        <span className={styles.meta}>
          <span className={styles.tag}>{ruleSource(r, c.accounts)}</span>
          <span>{r.level === "block" ? <Term term="Blocks" note="A draft that breaks this rule is rewritten once, then not saved.">Stops a draft</Term> : <Term term="Flags" note="A draft that breaks this rule is saved and marked for you to check.">Flags a draft</Term>}</span>
          {evidence && <span>From a review</span>}
          {isStartingRule(r) && <span>{STARTING_RULE_ORIGIN}</span>}
          <RuleState r={r} c={c} on={on} applies={applies} override={override} />
        </span>
        {evidence && <details className={styles.why}><summary>Why this became a rule</summary><blockquote>{evidence.comment}</blockquote><p>{evidence.reason}</p></details>}
      </div>
      <RuleActions r={r} c={c} on={on} applies={applies} override={override} />
    </li>
  );
}

/** Before a whole level is switched on or off: exactly which rules that changes for the target, then Confirm. */
function LevelConfirm({ affected, proposed, t, pending, onConfirm, onCancel }: { affected: Rule[]; proposed: Inheritance; t: Target; pending: boolean; onConfirm: () => void; onCancel: () => void }) {
  const comesBack = (r: Rule) => resolveRule({ ...r, inheritance: proposed }, t.network, t.account?.id).applies;
  return (
    <div className={styles.confirm} role="status">
      <p className={styles.confirmTitle}>{affected.length ? `This changes ${affected.length} rule${affected.length === 1 ? "" : "s"} for ${t.where}:` : `No current rule changes for ${t.where}. Future rules follow this setting too.`}</p>
      {affected.length > 0 && <ul className={styles.changeList}>{affected.map(r => <li key={r.id}><Badge tone={comesBack(r) ? "success" : "warning"} size="sm">{comesBack(r) ? "Comes back" : "Stops"}</Badge> {r.text}</li>)}</ul>}
      <p className={styles.help}>Any rules you switched off here stay saved, and come back if you turn this on again.</p>
      <div className={styles.row}>
        <Button size="sm" disabled={pending} onClick={onConfirm}>Confirm</Button>
        <Button variant="ghost" size="sm" disabled={pending} onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}

/** One group of rules, with the inherited group's level switches. */
function RuleGroup({ g, c, next, onPreview }: { g: { key: string; title: string; rules: Rule[] }; c: RowContext; next: Use; onPreview: (u: Use) => void }) {
  const inherited = g.key === "inherited";
  const { net, where } = c.t;
  return (
    <div className={styles.group}>
      <div className={styles.groupHead}>
        <h3 className={styles.groupTitle}>{inherited ? <Term term="Inherited rules" note="Rules set for all your accounts, or for every account on one network. This account follows them unless you turn one off here.">{g.title}</Term> : g.title}<span className={styles.count}>{g.rules.length}</span></h3>
        {inherited && (
          <div className={styles.switches}>
            <Switch label="All-account rules" checked={next.shared} disabled={c.pending} onCheckedChange={v => onPreview({ ...next, shared: v === true })} />
            {c.t.level === "account" && <Switch label={net} checked={next.network} disabled={c.pending} onCheckedChange={v => onPreview({ ...next, network: v === true })} />}
          </div>
        )}
      </div>
      {inherited && !c.netShared && <p className={styles.help}>{`All-account rules are off for every ${net} account, so this account can't turn one back on. Change it under "Every ${net} account".`}</p>}
      {g.rules.length ? <ul className={styles.rules}>{g.rules.map(r => <RuleRow key={r.id} r={r} c={c} />)}</ul> : <p className={styles.help}>{`Nothing inherited by ${where}.`}</p>}
    </div>
  );
}

export function RuleRouting({ rules, accounts, inheritance, onDelete, onAdd, example = false }: { rules: Rule[]; accounts: RuleAccount[]; inheritance: Inheritance; onDelete: (r: Rule) => void; onAdd: () => void; example?: boolean }) {
  // The example shows the same controls and says what they would do instead of saving.
  const setOverride: typeof changeRuleOverride = async (...a) => (example ? { ok: false, message: EXAMPLE_NOTE } : changeRuleOverride(...a));
  const setInheritance: typeof changeInheritance = async (...a) => (example ? { ok: false, message: EXAMPLE_NOTE } : changeInheritance(...a));
  const networks = [...new Set(accounts.map(a => a.service))];
  const [target, setTarget] = useState(accounts[0] ? `account:${accounts[0].id}` : "");
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [preview, setPreview] = useState<Use | null>(null);
  const { toast } = useToastStack();
  if (!target) return null;

  const t = targetOf(target, accounts);
  const { level, id, where } = t;
  const current = currentUse(t, inheritance);
  const next = preview ?? current;
  const proposed = proposedInheritance(t, inheritance, next);
  const decide = (r: Rule, inh: Inheritance) => resolveRule({ ...r, inheritance: inh }, t.network, t.account?.id);
  const affected = rules.filter(r => decide(r, inheritance).applies !== decide(r, proposed).applies);

  const save = (fn: () => Promise<Saved>, done: string) => start(async () => {
    try { const r = await fn(); setMessage(r?.ok === false ? { ok: false, text: r.message ?? "That didn't save. Try again." } : { ok: true, text: done }); }
    catch { setMessage({ ok: false, text: "That didn't save. Try again." }); }
  });
  const turnOff = (r: Rule) => start(async () => {
    const res = await setOverride(r.id, { level, id }, false).catch(() => null);
    if (!res?.ok) { setMessage({ ok: false, text: res?.message ?? "That didn't save. Try again." }); return; }
    setMessage(null);
    toast({ type: "success", title: `Turned off for ${where}`, description: r.text, duration: 8000, action: { label: "Undo", onClick: () => void setOverride(r.id, { level, id }, null) } });
  });
  const c: RowContext = {
    t, accounts, inheritance, current, pending, onDelete, onTurnOff: turnOff,
    netShared: level === "account" ? inheritance.networks?.[t.network]?.shared !== false : true,
    onSet: (r, on, done) => save(() => setOverride(r.id, { level, id }, on), done),
  };

  return (
    <section className={styles.card} aria-label="Rules">
      <div className={styles.bar}>
        <div className={styles.pick}>
          <Select label="Rules for" value={target} onValueChange={v => { setTarget(v); setPreview(null); setMessage(null); }} options={[
            ...accounts.map(a => ({ value: `account:${a.id}`, label: `${a.name} · ${NETWORKS[a.service] ?? a.service}` })),
            ...networks.map(n => ({ value: `network:${n}`, label: `Every ${NETWORKS[n] ?? n} account` })),
            { value: "all", label: `All rules (${rules.length})` },
          ]} />
        </div>
        <Button variant="secondary" size="sm" onClick={onAdd}>+ Rule</Button>
      </div>

      {preview && (preview.shared !== current.shared || preview.network !== current.network) && (
        <LevelConfirm affected={affected} proposed={proposed} t={t} pending={pending} onCancel={() => setPreview(null)}
          onConfirm={() => save(async () => { const r = await setInheritance({ level, id }, next.shared, next.network); if (r.ok) setPreview(null); return r; }, "Saved.")} />
      )}

      {groupsFor(rulesFor(rules, t), t).map(g => <RuleGroup key={g.key} g={g} c={c} next={next} onPreview={setPreview} />)}
      {message && <p role="status" className={message.ok ? styles.ok : styles.error}>{message.text}</p>}
    </section>
  );
}
