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
import styles from "./rule-routing.module.css";

export type RuleAccount = { id: string; name: string; service: string };
type Level = "shared" | "network" | "account";

/**
 * Rules for each account: pick an account (or every account on a network), see its rules grouped by where they come
 * from, switch one off or back on here, or stop using a whole level after seeing exactly which rules that changes.
 */
export function RuleRouting({ rules, accounts, inheritance }: { rules: Rule[]; accounts: RuleAccount[]; inheritance: Inheritance }) {
  const networks = [...new Set(accounts.map(a => a.service))];
  const [target, setTarget] = useState(accounts[0] ? `account:${accounts[0].id}` : "");
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [preview, setPreview] = useState<{ shared: boolean; network: boolean } | null>(null);
  const { toast } = useToastStack();
  if (!target) return null;

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
  const mine = rules.filter(r => r.accountIds?.length ? level === "account" && r.accountIds.includes(id) : r.channels === "all" || r.channels.includes(network));
  const origin = (r: Rule): Level => r.accountIds?.length ? "account" : r.channels === "all" ? "shared" : "network";
  const groups: { level: Level; title: string; used: boolean; rules: Rule[] }[] = [
    { level: "shared" as const, title: "Shared rules", used: current.shared, rules: mine.filter(r => origin(r) === "shared") },
    { level: "network" as const, title: `${net} rules`, used: current.network, rules: mine.filter(r => origin(r) === "network") },
    { level: "account" as const, title: "This account's own rules", used: true, rules: mine.filter(r => origin(r) === "account") },
  ].filter(g => g.rules.length > 0);

  const save = (fn: () => Promise<{ ok?: boolean; message?: string } | undefined>, done: string) => start(async () => {
    try { const r = await fn(); setMessage(r?.ok === false ? { ok: false, text: r.message ?? "That didn't save. Try again." } : { ok: true, text: done }); }
    catch { setMessage({ ok: false, text: "That didn't save. Try again." }); }
  });

  const row = (r: Rule, used: boolean) => {
    const d = decide(r, inheritance);
    const override = level === "account" ? r.overrides?.accounts?.[id] : r.overrides?.networks?.[id] ?? (r.except?.includes(id) ? false : undefined);
    const canChange = used && origin(r) !== "account" && (level === "account" || origin(r) === "shared");
    const state = !used ? { tone: "neutral" as const, label: "Not used here" }
      : override === false ? { tone: "warning" as const, label: "Off here" }
      : override === true ? { tone: "info" as const, label: "Turned on here" }
      : d.applies ? { tone: "neutral" as const, label: origin(r) === "account" ? "Applies" : "Inherited" }
      : { tone: "warning" as const, label: `Off for every ${net} account` };
    return (
      <li key={r.id} className={styles.rule} data-off={!used || !d.applies}>
        <div className={styles.ruleMain}>
          <span className={styles.ruleText}>{r.text}</span>
          <Badge tone={state.tone} size="sm">{state.label}</Badge>
        </div>
        {canChange && (
          <div className={styles.ruleActions}>
            {override === undefined && d.applies && <Button variant="ghost" size="sm" disabled={pending} onClick={() => start(async () => {
              const res = await changeRuleOverride(r.id, { level, id }, false).catch(() => null);
              if (!res?.ok) { setMessage({ ok: false, text: res?.message ?? "That didn't save. Try again." }); return; }
              setMessage(null);
              toast({ type: "success", title: `Turned off for ${where}`, description: r.text, duration: 8000, action: { label: "Undo", onClick: () => void changeRuleOverride(r.id, { level, id }, null) } });
            })}>Turn off here</Button>}
            {override === undefined && !d.applies && level === "account" && <Button variant="ghost" size="sm" disabled={pending} onClick={() => save(() => changeRuleOverride(r.id, { level, id }, true), `Turned on for ${where}.`)}>Turn on here</Button>}
            {override !== undefined && <Button variant="ghost" size="sm" disabled={pending} onClick={() => save(() => changeRuleOverride(r.id, { level, id }, null), "Back to the inherited setting.")}>{override ? "Undo" : "Turn back on"}</Button>}
          </div>
        )}
      </li>
    );
  };

  return (
    <section className={styles.card} aria-labelledby="routing-title">
      <div className={styles.head}>
        <h2 id="routing-title" className={styles.title}>Rules for each account</h2>
        <p className={styles.help}>Shared rules apply to every account. {net ? `${net} rules apply to every ${net} account. ` : ""}Each account can switch a rule off, turn one back on, or stop using a whole set.</p>
      </div>
      <div className={styles.pick}>
        <Select label="Show rules for" value={target} onValueChange={v => { setTarget(v); setPreview(null); setMessage(null); }} options={[
          ...accounts.map(a => ({ value: `account:${a.id}`, label: `${a.name} · ${NETWORKS[a.service] ?? a.service}` })),
          ...networks.map(n => ({ value: `network:${n}`, label: `Every ${NETWORKS[n] ?? n} account` })),
        ]} />
      </div>

      <div className={styles.switches}>
        <Switch label="Use shared rules" checked={next.shared} disabled={pending} onCheckedChange={v => setPreview({ ...next, shared: v === true })} />
        {level === "account" && <Switch label={`Use ${net} rules`} checked={next.network} disabled={pending} onCheckedChange={v => setPreview({ ...next, network: v === true })} />}
      </div>

      {preview && (preview.shared !== current.shared || preview.network !== current.network) && (
        <div className={styles.confirm} role="status">
          <p className={styles.confirmTitle}>{affected.length ? `This changes ${affected.length} rule${affected.length === 1 ? "" : "s"} for ${where}:` : `No current rule changes for ${where}. Future rules follow this setting too.`}</p>
          {affected.length > 0 && <ul className={styles.changeList}>{affected.map(r => <li key={r.id}><Badge tone={decide(r, proposed).applies ? "success" : "warning"} size="sm">{decide(r, proposed).applies ? "Comes back" : "Stops"}</Badge> {r.text}</li>)}</ul>}
          <p className={styles.help}>Any rules you switched off here stay saved, and come back if you turn this on again.</p>
          <div className={styles.row}>
            <Button size="sm" disabled={pending} onClick={() => save(async () => { const r = await changeInheritance({ level, id }, next.shared, next.network); if (r.ok) setPreview(null); return r; }, "Saved.")}>Confirm</Button>
            <Button variant="ghost" size="sm" disabled={pending} onClick={() => setPreview(null)}>Cancel</Button>
          </div>
        </div>
      )}

      {groups.length === 0 && <p className={styles.help}>{`No rules concern ${where} yet. Add one below, or keep one from a review comment.`}</p>}
      {groups.map(g => (
        <div key={g.level} className={styles.group} data-unused={!g.used}>
          <h3 className={styles.groupTitle}>{g.title}<span className={styles.count}>{g.rules.length}</span>{!g.used && <span className={styles.note}>{`Not used by ${where}`}</span>}</h3>
          <ul className={styles.rules}>{g.rules.map(r => row(r, g.used))}</ul>
        </div>
      ))}
      {message && <p role="status" className={message.ok ? styles.ok : styles.error}>{message.text}</p>}
    </section>
  );
}
