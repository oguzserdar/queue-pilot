"use client";
import { useState, useTransition } from "react";
import { changeInheritance, changeRuleOverride } from "@/app/(app)/review-actions";
import { resolveRule, type Inheritance } from "@/lib/rule-scopes";
import { NETWORKS, type Rule } from "@/lib/rules";
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

/**
 * Rules for each account: pick an account (or every account on a network), see its rules grouped by where they come
 * from, switch one off or back on here, or stop using a whole level after seeing exactly which rules that changes.
 */
const EXAMPLE_NOTE = "This is the example account. Sign in with Buffer to change where your own rules apply.";

export function RuleRouting({ rules, accounts, inheritance, onDelete, onAdd, example = false }: { rules: Rule[]; accounts: RuleAccount[]; inheritance: Inheritance; onDelete: (r: Rule) => void; onAdd: () => void; example?: boolean }) {
  // The example shows the same controls and says what they would do instead of saving.
  const setOverride: typeof changeRuleOverride = async (...a) => (example ? { ok: false, message: EXAMPLE_NOTE } : changeRuleOverride(...a));
  const setInheritance: typeof changeInheritance = async (...a) => (example ? { ok: false, message: EXAMPLE_NOTE } : changeInheritance(...a));
  const networks = [...new Set(accounts.map(a => a.service))];
  const [target, setTarget] = useState(accounts[0] ? `account:${accounts[0].id}` : "");
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [preview, setPreview] = useState<{ shared: boolean; network: boolean } | null>(null);
  const { toast } = useToastStack();
  if (!target) return null;

  const all = target === "all";
  const level = target.startsWith("account:") ? "account" : "network";
  const id = target.slice(target.indexOf(":") + 1);
  const account = accounts.find(a => a.id === id);
  const network = level === "network" ? id : account?.service ?? "";
  const net = NETWORKS[network] ?? network;
  const where = level === "account" ? account?.name ?? "this account" : `every ${net} account`;
  const current = level === "network" ? { shared: inheritance.networks?.[id]?.shared !== false, network: true } : { shared: inheritance.accounts?.[id]?.shared !== false, network: inheritance.accounts?.[id]?.network !== false };
  const next = preview ?? current;
  const proposed: Inheritance = level === "network" ? { ...inheritance, networks: { ...inheritance.networks, [id]: { shared: next.shared } } } : { ...inheritance, accounts: { ...inheritance.accounts, [id]: next } };
  const decide = (r: Rule, inh: Inheritance) => resolveRule({ ...r, inheritance: inh }, network, account?.id);
  const affected = rules.filter(r => decide(r, inheritance).applies !== decide(r, proposed).applies);

  // Only the rules that concern this account or network; another account's own rules are none of its business.
  const mine = all ? rules : rules.filter(r => r.accountIds?.length ? level === "account" && r.accountIds.includes(id) : r.channels === "all" || r.channels.includes(network));
  const origin = (r: Rule): Level => r.accountIds?.length ? "account" : r.channels === "all" ? "shared" : "network";
  const overrideOf = (r: Rule) => level === "account" ? r.overrides?.accounts?.[id] : r.overrides?.networks?.[id] ?? (r.except?.includes(id) ? false : undefined);
  // An account inherits shared rules only when both it and its network do (the same boundary resolveRule applies).
  const netShared = level === "account" ? inheritance.networks?.[network]?.shared !== false : true;
  const used = (r: Rule) => origin(r) === "shared" ? current.shared && netShared : origin(r) === "network" ? current.network : true;
  // Each rule once: what was changed here first, then this account's own, then what it inherits.
  const groups: { key: string; title: string; rules: Rule[] }[] = all
    ? [{ key: "all", title: "Every rule", rules: mine }]
    : [
        { key: "changed", title: `Changed for ${level === "account" ? "this account" : where}`, rules: mine.filter(r => origin(r) !== "account" && overrideOf(r) !== undefined) },
        { key: "own", title: "This account's own", rules: mine.filter(r => origin(r) === "account") },
        { key: "inherited", title: "Also applies here", rules: mine.filter(r => origin(r) !== "account" && overrideOf(r) === undefined) },
      ].filter(g => g.rules.length > 0 || g.key === "inherited");
  const source = (r: Rule) => origin(r) === "shared" ? "All accounts" : origin(r) === "network" ? (r.channels as string[]).map(c => NETWORKS[c] ?? c).join(", ") : r.accountIds!.map(a => accounts.find(x => x.id === a)?.name ?? "Disconnected account").join(", ");

  const save = (fn: () => Promise<{ ok?: boolean; message?: string } | undefined>, done: string) => start(async () => {
    try { const r = await fn(); setMessage(r?.ok === false ? { ok: false, text: r.message ?? "That didn't save. Try again." } : { ok: true, text: done }); }
    catch { setMessage({ ok: false, text: "That didn't save. Try again." }); }
  });

  const row = (r: Rule) => {
    const on = used(r);
    const d = decide(r, inheritance);
    const override = all ? undefined : overrideOf(r);
    const canChange = !all && on && origin(r) !== "account" && (level === "account" || origin(r) === "shared");
    const evidence = review(r.learnedFrom);
    const off = !all && (!on || !d.applies);
    return (
      <li key={r.id} className={styles.rule} data-off={off}>
        <div className={styles.ruleMain}>
          <span className={styles.ruleText}>{r.text}</span>
          <span className={styles.meta}>
            <span className={styles.tag}>{source(r)}</span>
            <span>{r.level === "block" ? <Term term="Blocks" note="A draft that breaks this rule is rewritten once, then not saved.">Stops a draft</Term> : <Term term="Flags" note="A draft that breaks this rule is saved and marked for you to check.">Warns you</Term>}</span>
            {evidence && <span>From a review</span>}
            {!all && !on && <span className={styles.warn}>{origin(r) === "shared" && !netShared ? `All-account rules are off for every ${net} account` : "Set not used here"}</span>}
            {!all && on && override === false && <span className={styles.warn}>Off here</span>}
            {!all && on && override === true && <span>On here</span>}
            {!all && on && override === undefined && !d.applies && <span className={styles.warn}>{`Off for every ${net} account`}</span>}
          </span>
          {evidence && <details className={styles.why}><summary>Why this became a rule</summary><blockquote>{evidence.comment}</blockquote><p>{evidence.reason}</p></details>}
        </div>
        <div className={styles.ruleActions}>
          {canChange && override === undefined && d.applies && <Button variant="ghost" size="sm" disabled={pending} onClick={() => start(async () => {
            const res = await setOverride(r.id, { level, id }, false).catch(() => null);
            if (!res?.ok) { setMessage({ ok: false, text: res?.message ?? "That didn't save. Try again." }); return; }
            setMessage(null);
            toast({ type: "success", title: `Turned off for ${where}`, description: r.text, duration: 8000, action: { label: "Undo", onClick: () => void setOverride(r.id, { level, id }, null) } });
          })}>Turn off here</Button>}
          {canChange && override === undefined && !d.applies && level === "account" && <Button variant="ghost" size="sm" disabled={pending} onClick={() => save(() => setOverride(r.id, { level, id }, true), `Turned on for ${where}.`)}>Turn on here</Button>}
          {canChange && override !== undefined && <Button variant="ghost" size="sm" disabled={pending} onClick={() => save(() => setOverride(r.id, { level, id }, null), "Back to the setting it follows.")}>Reset</Button>}
          {(all || origin(r) === "account") && <ConfirmButton label="Delete" ariaLabel={`Delete rule: ${r.text}`} question="Delete this rule?" confirmLabel="Delete rule" onConfirm={() => onDelete(r)} />}
        </div>
      </li>
    );
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
        <div className={styles.confirm} role="status">
          <p className={styles.confirmTitle}>{affected.length ? `This changes ${affected.length} rule${affected.length === 1 ? "" : "s"} for ${where}:` : `No current rule changes for ${where}. Future rules follow this setting too.`}</p>
          {affected.length > 0 && <ul className={styles.changeList}>{affected.map(r => <li key={r.id}><Badge tone={decide(r, proposed).applies ? "success" : "warning"} size="sm">{decide(r, proposed).applies ? "Comes back" : "Stops"}</Badge> {r.text}</li>)}</ul>}
          <p className={styles.help}>Any rules you switched off here stay saved, and come back if you turn this on again.</p>
          <div className={styles.row}>
            <Button size="sm" disabled={pending} onClick={() => save(async () => { const r = await setInheritance({ level, id }, next.shared, next.network); if (r.ok) setPreview(null); return r; }, "Saved.")}>Confirm</Button>
            <Button variant="ghost" size="sm" disabled={pending} onClick={() => setPreview(null)}>Cancel</Button>
          </div>
        </div>
      )}

      {groups.map(g => (
        <div key={g.key} className={styles.group}>
          <div className={styles.groupHead}>
            <h3 className={styles.groupTitle}>{g.key === "inherited" ? <Term term="Inherited rules" note="Rules set for all your accounts, or for every account on one network. This account follows them unless you turn one off here.">{g.title}</Term> : g.title}<span className={styles.count}>{g.rules.length}</span></h3>
            {g.key === "inherited" && (
              <div className={styles.switches}>
                <Switch label="All-account rules" checked={next.shared} disabled={pending} onCheckedChange={v => setPreview({ ...next, shared: v === true })} />
                {level === "account" && <Switch label={net} checked={next.network} disabled={pending} onCheckedChange={v => setPreview({ ...next, network: v === true })} />}
              </div>
            )}
          </div>
          {g.key === "inherited" && !netShared && <p className={styles.help}>{`All-account rules are off for every ${net} account, so this account can't turn one back on. Change it under "Every ${net} account".`}</p>}
          {g.rules.length ? <ul className={styles.rules}>{g.rules.map(row)}</ul> : <p className={styles.help}>{`Nothing inherited by ${where}.`}</p>}
        </div>
      ))}
      {message && <p role="status" className={message.ok ? styles.ok : styles.error}>{message.text}</p>}
    </section>
  );
}

function review(value: unknown): { comment: string; reason: string } | null {
  if (!value || typeof value !== "object") return null;
  const e = value as Record<string, unknown>;
  return e.kind === "review" && typeof e.comment === "string" && typeof e.reason === "string" ? { comment: e.comment, reason: e.reason } : null;
}
