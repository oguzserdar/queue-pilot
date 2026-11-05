"use client";

import { useState, useTransition } from "react";
import { removeUnusedAiApps, renameAiApp, revokeAiApp } from "@/app/(app)/actions";
import type { ApprovedApp } from "@/lib/ai-access";
import { MAX_LABEL, UNUSED_DAYS } from "@/lib/ai-app-limits";
import { sinceText } from "@/lib/connect-links";
import { Button } from "@/registry/components/button/button";
import { DropdownMenu } from "@/registry/components/dropdown-menu/dropdown-menu";
import { InlineEdit } from "@/registry/components/inline-edit/inline-edit";
import { useToastStack } from "@/registry/components/toast-stack/toast-stack";
import { AiMark } from "./ai-mark";
import styles from "./ai-apps.module.css";

const day = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(new Date(iso));

/** Connections grouped under the app they registered as, the app used most recently first. */
function groupByApp(apps: ApprovedApp[]) {
  const groups = new Map<string, ApprovedApp[]>();
  for (const a of apps) {
    const key = a.brand ?? a.name;
    groups.set(key, [...(groups.get(key) ?? []), a]);
  }
  const latest = (list: ApprovedApp[]) => Math.max(...list.map((a) => Date.parse(a.lastUsedAt ?? a.approvedAt)));
  return [...groups.entries()].sort((x, y) => latest(y[1]) - latest(x[1]));
}

/** The mark for a connection: the brand its registration verified, else its first letter. */
const mark = (a: ApprovedApp, fallback: string, size: number) =>
  a.brand ? <AiMark name={a.brand} size={size} /> : <span className={styles.tile} aria-hidden="true">{fallback.slice(0, 1)}</span>;

/** What a person needs to recognise a connection when reporting it or comparing two. */
function details(a: ApprovedApp) {
  return [a.label ?? a.name, `Registered as ${a.name}`, `Returns to ${a.returnsTo.join(", ") || "an unknown place"}`, `Approved ${day(a.approvedAt)}`, a.lastUsedAt ? `Last used ${new Date(a.lastUsedAt).toISOString()}` : "Not used yet", `${a.calls} calls`].join("\n");
}

/**
 * Every AI app connection that can use this account through the connector, grouped by app. Each connection says where
 * it sends you back to, when you approved it and when it was last used, and can be named, so two connections of the
 * same app can be told apart. Disconnecting asks once, inline, and takes effect on the app's next call.
 */
export function AiApps({ apps, now = Date.now() }: { apps: ApprovedApp[] | null; now?: number }) {
  const [confirming, setConfirming] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const { toast } = useToastStack();

  if (apps === null) return <p className={styles.muted}>Queue Pilot could not load this list just now. Reload the page.</p>;
  if (apps.length === 0) return <p className={styles.muted}>No AI app is connected yet. <a href="/connect">Connect one</a>.</p>;
  const unused = apps.filter((a) => a.unused).length;

  const disconnect = (a: ApprovedApp) => start(async () => {
    const r = await revokeAiApp(a.consentId);
    setConfirming(null);
    if (r.ok) { toast({ type: "success", title: `${a.label ?? a.name} can no longer use Queue Pilot.` }); setMessage(null); } else setMessage(r.message);
  });
  const removeUnused = () => start(async () => {
    const r = await removeUnusedAiApps();
    if (r.ok) { toast({ type: "success", title: r.title ?? "Removed." }); setMessage(null); } else setMessage(r.message);
  });
  const rename = async (a: ApprovedApp, next: string) => {
    const r = await renameAiApp(a.consentId, next);
    if (!r.ok) throw new Error(r.message);
  };

  const row = (a: ApprovedApp, withMark: boolean) => (
    <div key={a.consentId} className={styles.row} data-unused={a.unused || undefined}>
      {withMark ? mark(a, a.label ?? a.name, 20) : null}
      <div className={styles.who}>
        <InlineEdit variant="body" className={styles.name} value={a.label ?? ""} placeholder={a.name} label={`Name for this ${a.name} connection`} onSave={(next) => rename(a, next)} validate={(v) => (v.trim().length > MAX_LABEL ? `Keep it under ${MAX_LABEL} characters.` : null)} />
        <span className={styles.meta}>
          <span className={a.unused ? styles.stopped : undefined}>{a.unused ? "Stopped, unused" : a.lastUsedAt ? <><span className={styles.dot} aria-hidden="true" />Used {sinceText(a.lastUsedAt, now)}</> : "Not used yet"}</span>
          {a.returnsTo.length ? <span> · {a.returnsTo.join(" · ")}</span> : null}
        </span>
        {a.label && a.label.trim() !== a.name ? <span className={styles.note}>Registered as {a.name}.</span> : null}
      </div>
      <div className={styles.actions}>
        {confirming === a.consentId ? (
          <>
            <Button variant="danger" size="sm" disabled={pending} onClick={() => disconnect(a)}>{pending ? "Disconnecting…" : "Disconnect"}</Button>
            <Button variant="ghost" size="sm" disabled={pending} onClick={() => setConfirming(null)}>Cancel</Button>
          </>
        ) : (
          <DropdownMenu label="Manage" items={[
            { label: "Copy details", onSelect: () => { void navigator.clipboard.writeText(details(a)).then(() => toast({ type: "success", title: "Details copied." })); } },
            { label: "Disconnect", destructive: true, separatorBefore: true, onSelect: () => setConfirming(a.consentId) },
          ]} />
        )}
      </div>
    </div>
  );

  return (
    <div className={styles.wrap}>
      <div className={styles.list}>
        {groupByApp(apps).map(([app, list]) => {
          // One connection: one row, the app's mark on it. Several: a heading keeps them together.
          const rows = list.map((a) => row(a, list.length === 1));
          return list.length === 1 ? <section key={app} className={styles.group} aria-label={app}>{rows}</section> : (
            <section key={app} className={styles.group} aria-label={app}>
              <header className={styles.groupHead}>
                <strong className={styles.app}>{mark(list[0], app, 18)}{app}</strong>
                <span className={styles.muted}>{list.length} connections</span>
              </header>
              {rows}
            </section>
          );
        })}
      </div>
      <div className={styles.foot}>
        <span className={styles.muted}>{unused ? `${unused === 1 ? "1 connection" : `${unused} connections`} stopped after ${UNUSED_DAYS} days without use.` : `A connection unused for ${UNUSED_DAYS} days stops working. Click a name to rename it.`}</span>
        {unused > 0 && <Button variant="secondary" size="sm" disabled={pending} onClick={removeUnused}>{unused === 1 ? "Remove 1 unused" : `Remove ${unused} unused`}</Button>}
      </div>
      {message && <p className={styles.problem} role="alert">{message}</p>}
    </div>
  );
}
