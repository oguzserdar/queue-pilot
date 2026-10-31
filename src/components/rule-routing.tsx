"use client";
import { useState, useTransition } from "react";
import { changeInheritance, changeRuleOverride } from "@/app/(app)/review-actions";
import { resolveRule, type Inheritance } from "@/lib/rule-scopes";
import { NETWORKS, type Rule } from "@/lib/rules";
import { Button } from "@/registry/components/button/button";
import styles from "./playbook-view.module.css";
export type RuleAccount = { id: string; name: string; service: string };
export function RuleRouting({ rules, accounts, inheritance }: { rules: Rule[]; accounts: RuleAccount[]; inheritance: Inheritance }) {
  const networks = [...new Set(accounts.map(a => a.service))];
  const [target, setTarget] = useState(accounts[0] ? `account:${accounts[0].id}` : "");
  const [pending, start] = useTransition();
  const [message, setMessage] = useState("");
  const [preview, setPreview] = useState<{ shared: boolean; network: boolean } | null>(null);
  if (!target) return null;
  const level = target.startsWith("account:") ? "account" : "network";
  const id = target.slice(target.indexOf(":") + 1);
  const account = accounts.find(a => a.id === id);
  const network = level === "network" ? id : account?.service ?? "";
  const current = level === "network" ? { shared: inheritance.networks?.[id]?.shared !== false, network: true } : { shared: inheritance.accounts?.[id]?.shared !== false, network: inheritance.accounts?.[id]?.network !== false };
  const next = preview ?? current;
  const proposed: Inheritance = level === "network" ? { ...inheritance, networks: { ...inheritance.networks, [id]: { shared: next.shared } } } : { ...inheritance, accounts: { ...inheritance.accounts, [id]: next } };
  const affected = rules.filter(r => resolveRule({ ...r, inheritance }, network, account?.id).applies !== resolveRule({ ...r, inheritance: proposed }, network, account?.id).applies);
  return <section className={styles.routing} aria-label="Rules by account">
    <div><h2 className={styles.h2}>What applies where</h2><p className={styles.muted}>Shared rules, network rules, then this account. A local exception changes where a rule applies. Conflicting instructions remain visible.</p></div>
    <label htmlFor="routing-target">Show rules for</label>
    <select id="routing-target" value={target} onChange={e => { setTarget(e.target.value); setPreview(null); setMessage(""); }}>
      <optgroup label="Networks">{networks.map(n => <option key={n} value={`network:${n}`}>All {NETWORKS[n] ?? n} accounts</option>)}</optgroup>
      <optgroup label="Accounts">{accounts.map(a => <option key={a.id} value={`account:${a.id}`}>{a.name} · {NETWORKS[a.service] ?? a.service}</option>)}</optgroup>
    </select>
    <label><input type="checkbox" checked={next.shared} disabled={pending} onChange={e => setPreview({ ...next, shared: e.target.checked })} />Use shared rules</label>
    {level === "account" && <label><input type="checkbox" checked={next.network} disabled={pending} onChange={e => setPreview({ ...next, network: e.target.checked })} />Use {NETWORKS[network] ?? network} rules</label>}
    {preview && <div role="status"><p>{affected.length ? "This changes the following rules:" : "No current rules change. This setting also applies to future rules."}</p>
      <ul>{affected.map(r => <li key={r.id}>{resolveRule({ ...r, inheritance: proposed }, network, account?.id).applies ? "Returns" : "Stops applying"}: {r.text}</li>)}</ul>
      <p className={styles.muted}>Existing exceptions stay saved. Switching inheritance back on restores them.</p>
      <div className={styles.actions}><Button size="sm" disabled={pending} onClick={() => start(async () => { try { const r = await changeInheritance({ level, id }, next.shared, next.network); setMessage(r.message); if (r.ok) setPreview(null); } catch { setMessage("Could not save that setting. Try again."); } })}>Apply inheritance change</Button>
      <Button variant="ghost" size="sm" onClick={() => setPreview(null)}>Cancel</Button></div>
    </div>}
    {message && <p role="status">{message}</p>}
    {rules.map(r => {
      const decision = resolveRule({ ...r, inheritance: proposed }, network, account?.id);
      const own = r.accountIds?.length;
      if (own && !r.accountIds?.includes(account?.id ?? "")) return null;
      if (!own && r.channels !== "all" && !r.channels.includes(network)) return null;
      const override = level === "account" ? r.overrides?.accounts?.[id] : r.overrides?.networks?.[id] ?? (r.except?.includes(id) ? false : undefined);
      return <div className={styles.routeRow} key={r.id}>
        <div><strong>{r.text}</strong><p className={styles.muted}>{decision.origin === "shared" ? "Shared" : decision.origin === "network" ? NETWORKS[network] ?? network : "This account"} · {decision.applies ? "Applies" : "Off"} · {decision.reason}</p></div>
        {!own && (level === "account" || r.channels === "all") && <select aria-label={`Override: ${r.text}`} value={override === undefined ? "inherit" : override ? "include" : "exclude"} disabled={pending || !!preview} onChange={e => { const value = e.target.value === "inherit" ? null : e.target.value === "include"; start(async () => { try { const result = await changeRuleOverride(r.id, { level, id }, value); setMessage(result.message); } catch { setMessage("Could not change that rule. Try again."); } }); }}><option value="inherit">Inherit</option><option value="include">Include here</option><option value="exclude">Exclude here</option></select>}
      </div>;
    })}
  </section>;
}
