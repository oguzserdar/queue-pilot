"use client";

import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { approveDrafts, recheckMyDrafts } from "@/app/(app)/actions";
import { readSingleKeys, SINGLE_KEYS_EVENT } from "./keyboard-shortcuts";
import { Button } from "@/registry/components/button/button";
import { HoverCard } from "@/registry/components/hover-card/hover-card";
import { Checkbox } from "@/registry/components/checkbox/checkbox";
import { useToastStack } from "@/registry/components/toast-stack/toast-stack";
import { isTypingTarget } from "@/lib/shortcuts";
import { TRIAGE_GROUPS, type TriageItem } from "@/lib/triage-model";
import type { PostState } from "@/lib/post-state";
import { StateMark } from "./state-mark";
import styles from "./triage-list.module.css";

const MARK: Record<TriageItem["kind"], PostState> = { repeat: "check", breaks: "breaks", failed: "failed", overdue: "draft", approve: "draft", taken: "draft", check: "check", comment: "draft", empty: "empty" };
const external = (href: string) => /^https?:\/\//.test(href);

/** An approved row folds away, and the rows below slide up into its place, before it leaves the list. */
async function foldAway(ids: string[]): Promise<void> {
  const els = ids.map((id) => document.querySelector<HTMLElement>(`[data-post="${CSS.escape(id)}"]`)).filter((el): el is HTMLElement => !!el);
  els.forEach((el) => { el.style.height = `${el.offsetHeight}px`; });
  void document.body.offsetHeight;
  els.forEach((el) => el.setAttribute("data-leaving", ""));
  if (els.length && !matchMedia("(prefers-reduced-motion: reduce)").matches) await new Promise((r) => setTimeout(r, 300));
}

/** A key press the list leaves alone: shortcuts off, a held or composed key, a modifier, typing, or an open dialog. */
function ignoredKey(e: KeyboardEvent, keysOn: boolean): boolean {
  if (!keysOn || e.repeat || e.isComposing || e.defaultPrevented) return true;
  if (e.metaKey || e.ctrlKey || e.altKey) return true;
  return isTypingTarget(document.activeElement) || !!document.querySelector('[role="dialog"]');
}

/** The id of a draft that can be approved from its row, if this row is one. */
const approvable = (item: TriageItem | undefined) => (item?.run === "approve" ? item.postId : undefined);

/** A row's words: the title and its one-line detail, the whole draft or reason opening on hover or focus. */
function RowText({ item }: { item: TriageItem }) {
  const text = (
    <div className={styles.text}>
      <span className={styles.title}>{item.title}</span>
      <span className={styles.detail}>{item.postId && item.kind !== "comment" ? `Draft · ${item.detail}` : item.detail}</span>
    </div>
  );
  // Long drafts and reasons stay one line in the row; the whole of each opens on hover or focus.
  if (!item.full) return text;
  return (
    <HoverCard className={styles.peekCard} content={<div className={styles.peek}><p className={styles.peekText}>{item.full}</p>{item.why && <p className={styles.peekWhy}>{item.why}</p>}</div>}>
      {text}
    </HoverCard>
  );
}

/** A row's one action: Approve or Check again here, or a link to where it is done (a new tab when it leaves the app). */
function RowAction({ item, keysOn, pending, onApprove, onRecheck }: { item: TriageItem; keysOn: boolean; pending: boolean; onApprove: (id: string) => void; onRecheck: (id: string) => void }) {
  const { postId } = item;
  if (item.run === "approve") return <Button variant="secondary" size="sm" disabled={pending} onClick={() => { if (postId) onApprove(postId); }}>{item.action}{keysOn && <kbd className={styles.key}>A</kbd>}</Button>;
  if (item.run === "recheck") return <Button variant="secondary" size="sm" disabled={pending} onClick={() => { if (postId) onRecheck(postId); }}>{item.action}</Button>;
  if (external(item.href)) return <a href={item.href} target="_blank" rel="noreferrer" className={styles.action}>{item.action}<ArrowUpRight size={14} strokeWidth={2} aria-hidden="true" />{keysOn && <kbd className={styles.key}>↵</kbd>}</a>;
  return <Link href={item.href} className={styles.action}>{item.action}{keysOn && <kbd className={styles.key}>↵</kbd>}</Link>;
}

/**
 * Everything that needs the person, grouped by why, one action each. J and K move, X ticks, A approves, Enter opens.
 * Ticked drafts are approved together from the bar at the bottom.
 */
export function TriageList({ items, live, onRemaining }: { items: TriageItem[]; live: boolean; onRemaining?: (n: number) => void }) {
  const [focus, setFocus] = useState(-1);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [done, setDone] = useState<Set<string>>(new Set());
  const [pending, start] = useTransition();
  const router = useRouter();
  const { toast } = useToastStack();
  const rows = useRef<(HTMLLIElement | null)[]>([]);
  const shown = TRIAGE_GROUPS.map((g) => ({ ...g, items: items.filter((i) => i.kind === g.kind && !(i.postId && done.has(i.postId))) })).filter((g) => g.items.length);
  const flat = shown.flatMap((g) => g.items);
  // Empty times are listed but not counted: they are room to fill, not something waiting on the person.
  const waiting = flat.filter((i) => i.kind !== "empty").length;
  useEffect(() => { onRemaining?.(waiting); }, [waiting, onRemaining]);

  const leave = async (ids: string[]) => {
    await foldAway(ids);
    setDone((s) => new Set([...s, ...ids]));
  };

  const approve = (ids: string[], opts?: { one?: boolean }) => start(async () => {
    if (!live) { await leave(ids); setPicked(new Set()); toast({ type: "success", title: `${ids.length} approved`, description: "On this example page only." }); return; }
    const r = await approveDrafts(ids, opts);
    if (!r.ok) { toast({ type: "error", title: "Nothing was scheduled", description: r.kind === "limited" ? "Buffer's request limit is reached. Try again in a few minutes." : "Buffer could not be reached." }); return; }
    setPicked(new Set());
    await leave(r.approved);
    if (r.approved.length) toast({ type: "success", title: `${r.approved.length} post${r.approved.length === 1 ? "" : "s"} scheduled in Buffer`, ...(r.note ? { description: r.note } : {}) });
    if (r.refused.length) toast({ type: "error", title: `${r.refused.length} not scheduled`, description: r.refused.map((x) => x.reason).join(" ") });
    router.refresh();
  });
  const recheck = (id: string) => start(async () => {
    if (!live) { toast({ type: "success", title: "Checked", description: "On this example page only." }); return; }
    const r = await recheckMyDrafts([id]);
    if (!r.ok) { toast({ type: "error", title: "Not checked", description: r.message }); return; }
    toast({ type: "success", title: "Checked against your playbook" });
    router.refresh();
  });
  // Single-key shortcuts follow the person's switch (Keyboard shortcuts, ?), including changes made on this page.
  const [keysOn, setKeysOn] = useState(true);
  useEffect(() => {
    const sync = () => setKeysOn(readSingleKeys());
    sync();
    window.addEventListener(SINGLE_KEYS_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => { window.removeEventListener(SINGLE_KEYS_EVENT, sync); window.removeEventListener("storage", sync); };
  }, []);
  const openHref = (href: string) => { if (external(href)) window.open(href, "_blank", "noreferrer"); else router.push(href); };
  const toggle = (id: string) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (ignoredKey(e, keysOn)) return;
      const k = e.key.toLowerCase();
      const item = flat[focus];
      const id = approvable(item);
      if (k === "j" || k === "k") {
        e.preventDefault();
        const next = Math.min(flat.length - 1, Math.max(0, focus + (k === "j" ? 1 : -1)));
        setFocus(next);
        rows.current[next]?.scrollIntoView({ block: "nearest" });
      } else if (k === "x" && id) { e.preventDefault(); toggle(id); }
      else if (k === "a" && id && !pending) { e.preventDefault(); approve([id], { one: true }); }
      else if (k === "enter" && item && document.activeElement === document.body) { e.preventDefault(); openHref(item.href); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  if (!flat.length) return <p className={styles.clear}>You&apos;re clear. Anything that needs you next shows up here.</p>;
  // Each row's place in the J/K order, which runs through the groups as they are shown.
  const position = new Map(flat.map((item, n) => [item, n]));
  return (
    <div className={styles.wrap}>
      {shown.map((g) => (
        <section key={g.kind} className={styles.group} aria-labelledby={`g-${g.kind}`}>
          <h2 id={`g-${g.kind}`} className={styles.groupHead}>{g.label}<span className={styles.count}>{g.items.length}</span></h2>
          <ul className={styles.rows}>
            {g.items.map((item) => {
              const at = position.get(item) ?? -1;
              const id = approvable(item);
              return (
                <li key={item.id} data-post={item.postId} ref={(el) => { rows.current[at] = el; }} className={styles.row} data-focus={focus === at || undefined} data-picked={(id && picked.has(id)) || undefined} data-picking={picked.size > 0 || undefined} onMouseEnter={() => setFocus(at)}>
                  {/* A draft ready to approve shows its tick box; everything else shows its state mark. */}
                  <span className={styles.lead}>
                    {id
                      ? <Checkbox aria-label={`Select: ${item.title}`} checked={picked.has(id)} onCheckedChange={() => toggle(id)} />
                      : <StateMark state={MARK[item.kind]} />}
                  </span>
                  <RowText item={item} />
                  <RowAction item={item} keysOn={keysOn} pending={pending} onApprove={(postId) => approve([postId], { one: true })} onRecheck={recheck} />
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      {keysOn && <p className={styles.hint}><kbd className={styles.key}>J</kbd> <kbd className={styles.key}>K</kbd> move · <kbd className={styles.key}>X</kbd> tick · <kbd className={styles.key}>A</kbd> approve · <kbd className={styles.key}>↵</kbd> open</p>}
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
