"use client";

import { Check } from "lucide-react";
import { ArrowUpRight } from "lucide-react";

import Link from "next/link";
import { EmptyState } from "@/registry/components/empty-state/empty-state";
import styles from "./needs-you-view.module.css";

/** One thing on the home screen that needs the person, with the page that fixes it. */
export type NeedItem = { id: string; tone: "warning" | "danger" | "success"; title: string; detail: string; action: string; href: string };
/** One setup step on the home checklist. */
export type ReadinessItem = { id: string; label: string; state: "done" | "todo" | "check"; detail: string; action?: string; href?: string };

/** Home: what needs the user right now, and until setup is complete, the readiness checklist. */
export function NeedsYouView({ needs, readiness, greeting }: { needs: NeedItem[]; readiness: ReadinessItem[]; greeting: string }) {
  const open = needs.filter((n) => n.tone !== "success");
  const done = readiness.filter((r) => r.state === "done").length;
  const ready = done === readiness.length;
  // A new account has nothing to catch up on yet: setup is the page until it is done or something needs attention.
  const settingUp = !ready && open.length === 0;
  // The first unfinished step carries the page's one primary button.
  const next = readiness.find((r) => r.state !== "done");

  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <p className={styles.greet}>{greeting}</p>
        <h1 className={styles.title}>{settingUp ? "Set up Queue Pilot" : open.length === 0 ? "All caught up." : `${open.length} thing${open.length === 1 ? "" : "s"} need${open.length === 1 ? "s" : ""} you.`}</h1>
        {settingUp && <p className={styles.lede}>{done} of {readiness.length} done. Each step takes about a minute, and then your AI fills your week in Buffer.</p>}
      </header>

      {settingUp ? null : needs.length === 0 ? (
        <EmptyState
          title="Nothing needs you right now"
          description="A draft that needs a look, or a post Buffer could not send, shows up here."
          action={<Link href="/week" className={styles.action}>Open next week</Link>}
        />
      ) : (
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
      )}

      {!ready && (
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
                <span className={styles.check} aria-hidden="true">{r.state === "done" ? <Check size={13} strokeWidth={3} color="#fff" /> : i + 1}</span>
                <span className="sr-only">{r.state === "done" ? "Done: " : r.state === "check" ? "Needs a look: " : "To do: "}</span>
                <div className={styles.needText}>
                  <strong>{r.label}</strong>
                  <span className={styles.muted}>{r.detail}</span>
                </div>
                {r.state !== "done" && r.action && r.href ? (
                  r.href.startsWith("http")
                    ? <a href={r.href} target="_blank" rel="noreferrer" className={r === next ? styles.primary : styles.action}>{r.action} <ArrowUpRight size={15} strokeWidth={2} aria-hidden="true" /></a>
                    : <Link href={r.href} className={r === next ? styles.primary : styles.action}>{r.action}</Link>
                ) : <span />}
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}
