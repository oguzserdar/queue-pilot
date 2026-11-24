"use client";

import { Check } from "lucide-react";
import { ArrowUpRight } from "lucide-react";

import Link from "next/link";
import { EmptyState } from "@/registry/components/empty-state/empty-state";
import type { TriageItem } from "@/lib/triage-model";
import { TriageList } from "./triage-list";
import { RollingNumber } from "./rolling-number";
import { useState, type ReactNode } from "react";
import styles from "./needs-you-view.module.css";

/** One thing on the home screen that needs the person, with the page that fixes it. */
export type NeedItem = { id: string; tone: "warning" | "danger" | "success"; title: string; detail: string; action: string; href: string };
/** One setup step on the home checklist. */
export type ReadinessItem = { id: string; label: string; state: "done" | "todo" | "check"; detail: string; action?: string; href?: string };

/** The home title: setup while there is nothing to catch up on, else how many things are waiting. */
function HomeTitle({ settingUp, left }: { settingUp: boolean; left: number }) {
  if (settingUp) return <h1 className={styles.title}>Set up Queue Pilot</h1>;
  if (left === 0) return <h1 className={styles.title}>All caught up.</h1>;
  return <h1 className={styles.title}><RollingNumber value={left} />{` thing${left === 1 ? "" : "s"} need${left === 1 ? "s" : ""} you.`}</h1>;
}

/** A step's link: outside pages open in a new tab (with the arrow when asked for), our own pages go through Link. */
function StepLink({ href, children, className, arrow = false }: { href: string; children: ReactNode; className: string; arrow?: boolean }) {
  if (!href.startsWith("http")) return <Link href={href} className={className}>{children}</Link>;
  return <a href={href} target="_blank" rel="noreferrer" className={className}>{children}{arrow && <> <ArrowUpRight size={15} strokeWidth={2} aria-hidden="true" /></>}</a>;
}

/** What a step's box shows: a tick when done, else its number. */
const stepMark = (r: ReadinessItem, i: number) => (r.state === "done" ? <Check size={13} strokeWidth={3} color="#fff" /> : i + 1);

const STEP_STATE: Record<ReadinessItem["state"], string> = { done: "Done: ", check: "Needs a look: ", todo: "To do: " };

/** The one setup line at the top while something else needs the person; the full list of steps opens from it. */
function SetupStrip({ readiness, next, done }: { readiness: ReadinessItem[]; next: ReadinessItem; done: number }) {
  return (
    <details className={styles.setupStrip}>
      <summary>
        <span className={styles.stripText}><strong>Finish setting up</strong><span className={styles.muted}>{done} of {readiness.length} done · Next: {next.label}</span></span>
        <span className={styles.stripBar} aria-hidden="true"><span style={{ width: `${(done / readiness.length) * 100}%` }} /></span>
        {next.action && next.href && <StepLink href={next.href} className={styles.primary} arrow>{next.action}</StepLink>}
        <span className={styles.stripMore}>All steps</span>
      </summary>
      <ol className={styles.steps}>
        {readiness.map((r, i) => (
          <li key={r.id} className={styles.step} data-state={r.state} data-next={r === next ? "true" : undefined}>
            <span className={styles.check} aria-hidden="true">{stepMark(r, i)}</span>
            <div className={styles.needText}><strong>{r.label}</strong><span className={styles.muted}>{r.detail}</span></div>
            {r.state !== "done" && r.action && r.href && r !== next ? <StepLink href={r.href} className={styles.action}>{r.action}</StepLink> : <span />}
          </li>
        ))}
      </ol>
    </details>
  );
}

/** What needs the person: the triage list when there is one, else the needs, or a calm empty state. */
function HomeList({ needs, triage, live, onRemaining }: { needs: NeedItem[]; triage?: TriageItem[]; live: boolean; onRemaining: (n: number) => void }) {
  if (triage) return <TriageList items={triage} live={live} onRemaining={onRemaining} />;
  if (needs.length === 0) {
    return (
      <EmptyState
        title="Nothing needs you right now"
        description="A draft that needs a look, or a post Buffer could not send, shows up here."
        action={<Link href="/week" className={styles.action}>Open next week</Link>}
      />
    );
  }
  return (
    <ul className={styles.needs} aria-label="Needs you">
      {needs.map((n) => (
        <li key={n.id} className={styles.need} data-tone={n.tone}>
          <span className={styles.mark} aria-hidden="true" />
          <div className={styles.needText}>
            <strong>{n.title}</strong>
            <span className={styles.muted}>{n.detail}</span>
          </div>
          <Link href={n.href} className={styles.action}>{n.action}</Link>
        </li>
      ))}
    </ul>
  );
}

/** The full setup checklist: progress (once past the first visit), then every step with its action. */
function ReadinessList({ readiness, next, done, settingUp }: { readiness: ReadinessItem[]; next: ReadinessItem | undefined; done: number; settingUp: boolean }) {
  return (
    <section className={styles.ready} aria-labelledby="ready-title">
      <div className={styles.readyHead}>
        <h2 id="ready-title" className={settingUp ? "sr-only" : styles.h2}>Finish setting up</h2>
        {!settingUp && <span className={styles.progress}>{done} of {readiness.length} done</span>}
      </div>
      {!settingUp && <div className={styles.bar} role="progressbar" aria-valuemin={0} aria-valuemax={readiness.length} aria-valuenow={done} aria-label="Setup progress">
        <span style={{ width: `${(done / readiness.length) * 100}%` }} />
      </div>}
      <ol className={styles.steps}>
        {readiness.map((r, i) => (
          <li key={r.id} className={styles.step} data-state={r.state} data-next={r === next ? "true" : undefined}>
            <span className={styles.check} aria-hidden="true">{stepMark(r, i)}</span>
            <span className="sr-only">{STEP_STATE[r.state]}</span>
            <div className={styles.needText}>
              <strong>{r.label}</strong>
              <span className={styles.muted}>{r.detail}</span>
            </div>
            {r.state !== "done" && r.action && r.href ? <StepLink href={r.href} className={r === next ? styles.primary : styles.action} arrow>{r.action}</StepLink> : <span />}
          </li>
        ))}
      </ol>
    </section>
  );
}

/**
 * Which parts of home show. A first visit's welcome is the whole page. Setting up with nothing to catch up on, the
 * checklist is the page. Otherwise the list leads, with setup as one line above it while it is unfinished.
 */
function homeSections(hasTriage: boolean, ready: boolean, settingUp: boolean, welcome: boolean): { strip: boolean; list: boolean; checklist: boolean } {
  if (welcome) return { strip: false, list: false, checklist: false };
  return { strip: hasTriage && !ready && !settingUp, list: !settingUp, checklist: !ready && !(hasTriage && !settingUp) };
}

/** Home: what needs the user right now, and until setup is complete, the readiness checklist. */
export function NeedsYouView({ needs, readiness, greeting, triage, live = false, start, welcome = false, noBuffer = false }: { /** Signed in without Buffer: the setup line does not mention Buffer. */ noBuffer?: boolean; needs: NeedItem[]; readiness: ReadinessItem[]; greeting: string; triage?: TriageItem[]; live?: boolean; /** The first-drafts panel, shown above everything until Queue Pilot has written a draft. */ start?: ReactNode; /** `start` is the first-visit welcome: it is the whole page until the person picks a path or says Not now, so the count, the setup strip and the list wait. */ welcome?: boolean }) {
  // Empty times are room to fill, not something waiting on the person, so they are left out of the count.
  const open = triage ? triage.filter((t) => t.kind !== "empty") : needs.filter((n) => n.tone !== "success");
  // The list reports what is left as rows are approved, so the title counts down with it.
  const [left, setLeft] = useState(open.length);
  const done = readiness.filter((r) => r.state === "done").length;
  const ready = done === readiness.length;
  // A new account has nothing to catch up on yet: setup is the page until it is done or something needs attention.
  const settingUp = !ready && open.length === 0;
  // The first unfinished step carries the page's one primary button.
  const next = readiness.find((r) => r.state !== "done");
  const show = homeSections(!!triage, ready, settingUp, welcome);

  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <p className={styles.greet}>{greeting}</p>
        {!welcome && <HomeTitle settingUp={settingUp} left={left} />}
        {settingUp && !welcome && <p className={styles.lede}>{done} of {readiness.length} done. Each step takes about a minute, and then {noBuffer ? "you plan your week here and Queue Pilot posts it" : "your AI fills your week in Buffer"}.</p>}
      </header>

      {start}

      {/* While setup is unfinished it stays at the top as one line with the next step; the full list opens from it. */}
      {show.strip && next && <SetupStrip readiness={readiness} next={next} done={done} />}

      {show.list && <HomeList needs={needs} triage={triage} live={live} onRemaining={setLeft} />}

      {/* On a first visit the welcome is the whole page; its own choice leads to setup. */}
      {show.checklist && <ReadinessList readiness={readiness} next={next} done={done} settingUp={settingUp} />}
    </div>
  );
}
