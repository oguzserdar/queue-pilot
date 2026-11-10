"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { writeMyWeek, type WriteWeekActionResult } from "@/app/(app)/actions";
import { Alert } from "@/registry/components/alert/alert";
import { Button } from "@/registry/components/button/button";
import type { WritingAvailability } from "@/lib/writing-availability";
import { useNextSteps } from "./use-next-steps";
import styles from "./write-week-button.module.css";

/**
 * Fill the displayed week using either the person's key or the available built-in allowance.
 * The result says what was saved, what the playbook refused, and why.
 */
export function WriteWeekButton({ availability, count, inlineActions = false, example = false, week = "next", onWriting }: { availability: WritingAvailability; count: number; inlineActions?: boolean; example?: boolean; /** Which week the button fills. */ week?: "this" | "next"; /** Told when a run starts and ends, so the week can show the times being written. */ onWriting?: (writing: boolean) => void }) {
  const [result, setResult] = useState<WriteWeekActionResult | null>(null);
  const [pending, start] = useTransition();
  const [showing, setShowing] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const router = useRouter();
  const suggest = useNextSteps();
  const busy = pending || showing;
  useEffect(() => {
    onWriting?.(busy);
    if (!busy) return;
    setSeconds(0);
    const t = setInterval(() => setSeconds((n) => n + 1), 1000);
    return () => clearInterval(t);
    // onWriting is a state setter in the caller; leaving it out keeps the timer from restarting on each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy]);
  // The run is one request, so the line follows the usual pace of a run (about 40 seconds for ten drafts) and
  // holds on the last step until the answer arrives.
  const step = seconds < 4 ? "Reading what you published…" : seconds < 4 + count * 2.6 ? `Writing ${count} draft${count === 1 ? "" : "s"} in your voice…` : seconds < 9 + count * 2.6 ? "Checking each one against your playbook…" : "Saving to Buffer as drafts…";

  if (!availability.ready) return <p style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>{availability.message} <a href="/settings?tab=ai#ai-key">AI settings</a></p>;
  if (!count) return <p style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>No empty times are left to fill {week === "this" ? "this week" : "next week"}.</p>;
  return (
    <div className={inlineActions ? styles.inline : styles.group}>
      <Button variant="secondary" size="lg" disabled={busy} onClick={() => example ? (setResult(null), setShowing(true), void setTimeout(() => { setShowing(false); setResult({ ok: false, message: "That is how a week fills. This is the example account, so nothing was written. Sign in with Buffer and Queue Pilot fills your own empty times." }); }, 9000)) : start(async () => {
        const r = await writeMyWeek(week);
        setResult(r);
        suggest(r.next);
        if (r.ok) router.refresh();
      })}>
        {busy ? "Writing…" : week === "this" ? "Fill this week" : "Fill next week"}
      </Button>
      {busy ? <p className={styles.step} role="status">{step}</p> :
      <p className={styles.help}>Writes {count} draft{count === 1 ? "" : "s"} into your Buffer posting times{week === "this" ? " still ahead this week" : ""}, spread across the days, using {availability.source}. At most 10 a run. Saved as drafts in Buffer for your review.</p>}
      {result && <div className={styles.result}>
      {result && !result.ok && <Alert tone={example ? "info" : "danger"} title={example ? "Example only" : "No drafts written"}>{result.message}</Alert>}
      {result && result.ok && (
        <Alert tone={result.refused.length || result.flags.length || result.note ? "warning" : "success"} title={`${result.saved.length} draft${result.saved.length === 1 ? "" : "s"} saved in Buffer`}>
          {result.retried > 0 && <p>{result.retried} draft{result.retried === 1 ? "" : "s"} broke a "do not save" rule in your playbook and {result.retried === 1 ? "was" : "were"} rewritten once.</p>}
          {result.refused.map((r) => <p key={r.slotId}>Not saved: {r.reason}</p>)}
          {result.flags.map((j, i) => <p key={i}>{j.verdict === "fail" ? "Check" : "Not sure"}: {j.where}, "{j.rule}"{j.reason ? `. ${j.reason}` : ""}</p>)}
          {result.note && <p>{result.note}</p>}
        </Alert>
      )}
      </div>}
    </div>
  );
}
