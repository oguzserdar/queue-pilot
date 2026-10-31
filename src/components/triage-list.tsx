"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { approveDrafts } from "@/app/(app)/actions";
import { Button } from "@/registry/components/button/button";
import { Checkbox } from "@/registry/components/checkbox/checkbox";
import { useToastStack } from "@/registry/components/toast-stack/toast-stack";
import { isTypingTarget } from "@/lib/shortcuts";
import { TRIAGE_GROUPS, type TriageItem } from "@/lib/triage-model";
import type { PostState } from "@/lib/post-state";
import { StateMark } from "./state-mark";
import styles from "./triage-list.module.css";

const MARK: Record<TriageItem["kind"], PostState> = { breaks: "breaks", failed: "failed", approve: "draft", check: "check", comment: "draft", empty: "empty" };

/**
 * Everything that needs the person, grouped by why, one action each. J and K move, X ticks, A approves, Enter opens.
 * Ticked drafts are approved together from the bar at the bottom.
 */
export function TriageList({ items, live }: { items: TriageItem[]; live: boolean }) {
  const [focus, setFocus] = useState(0);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [done, setDone] = useState<Set<string>>(new Set());
  const [pending, start] = useTransition();
  const router = useRouter();
  const { toast } = useToastStack();
  const rows = useRef<(HTMLLIElement | null)[]>([]);
  const shown = TRIAGE_GROUPS.map((g) => ({ ...g, items: items.filter((i) => i.kind === g.kind && !(i.postId && done.has(i.postId))) })).filter((g) => g.items.length);
  const flat = shown.flatMap((g) => g.items);

  const approve = (ids: string[]) => start(async () => {
    if (!live) { setDone((s) => new Set([...s, ...ids])); setPicked(new Set()); toast({ type: "success", title: `${ids.length} approved`, description: "On this example page only." }); return; }
    const r = await approveDrafts(ids);
    if (!r.ok) { toast({ type: "error", title: "Nothing was scheduled", description: r.kind === "limited" ? "Buffer's request limit is reached. Try again in a few minutes." : "Buffer could not be reached." }); return; }
    setDone((s) => new Set([...s, ...r.approved]));
    setPicked(new Set());
    if (r.approved.length) toast({ type: "success", title: `${r.approved.length} post${r.approved.length === 1 ? "" : "s"} scheduled in Buffer` });
    if (r.refused.length) toast({ type: "error", title: `${r.refused.length} not scheduled`, description: r.refused.map((x) => x.reason).join(" ") });
    router.refresh();
  });
  const toggle = (id: string) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(document.activeElement) || document.querySelector('[role="dialog"]')) return;
      const k = e.key.toLowerCase();
      const item = flat[focus];
      if (k === "j" || k === "k") {
        e.preventDefault();
        const next = Math.min(flat.length - 1, Math.max(0, focus + (k === "j" ? 1 : -1)));
        setFocus(next);
        rows.current[next]?.scrollIntoView({ block: "nearest" });
      } else if (k === "x" && item?.postId) { e.preventDefault(); toggle(item.postId); }
      else if (k === "a" && item?.postId && !pending) { e.preventDefault(); approve([item.postId]); }
      else if (k === "enter" && item && document.activeElement === document.body) { e.preventDefault(); router.push(item.href); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  if (!flat.length) return <p className={styles.clear}>You&apos;re clear. Anything that needs you next shows up here.</p>;
  let i = -1;
  return (
    <div className={styles.wrap}>
      {shown.map((g) => (
        <section key={g.kind} className={styles.group} aria-labelledby={`g-${g.kind}`}>
          <h2 id={`g-${g.kind}`} className={styles.groupHead}>{g.label}<span className={styles.count}>{g.items.length}</span></h2>
          <ul className={styles.rows}>
            {g.items.map((item) => {
              i += 1;
              const at = i;
              return (
                <li key={item.id} ref={(el) => { rows.current[at] = el; }} className={styles.row} data-focus={focus === at || undefined} onMouseEnter={() => setFocus(at)}>
                  {item.postId ? <Checkbox aria-label={`Select: ${item.title}`} checked={picked.has(item.postId)} onCheckedChange={() => toggle(item.postId!)} /> : <span />}
                  <StateMark state={MARK[item.kind]} />
                  <div className={styles.text}>
                    <span className={styles.title}>{item.title}</span>
                    <span className={styles.detail}>{item.detail}</span>
                  </div>
                  {item.postId ? (
                    <Button variant="secondary" size="sm" disabled={pending} onClick={() => approve([item.postId!])}>{item.action}<kbd className={styles.key}>A</kbd></Button>
                  ) : (
                    <Link href={item.href} className={styles.action}>{item.action}<kbd className={styles.key}>↵</kbd></Link>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      <p className={styles.hint}><kbd className={styles.key}>J</kbd> <kbd className={styles.key}>K</kbd> move · <kbd className={styles.key}>X</kbd> tick · <kbd className={styles.key}>A</kbd> approve · <kbd className={styles.key}>↵</kbd> open</p>
      {picked.size > 0 && (
        <div className={styles.bar} role="region" aria-label="Selected drafts">
          <span>{picked.size} selected</span>
          <Button variant="primary" size="sm" disabled={pending} onClick={() => approve([...picked])}>{pending ? "Approving…" : `Approve ${picked.size}`}</Button>
          <Button variant="ghost" size="sm" onClick={() => setPicked(new Set())}>Clear</Button>
        </div>
      )}
    </div>
  );
}
