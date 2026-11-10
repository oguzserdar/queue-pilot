"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { nextStepsAfterFill, type WriteWeekActionResult } from "@/app/(app)/actions";
import { Alert } from "@/registry/components/alert/alert";
import { Button } from "@/registry/components/button/button";
import type { WritingAvailability } from "@/lib/writing-availability";
import { useNextSteps } from "./use-next-steps";
import styles from "./write-week-button.module.css";

/** What a running fill reports to the week. */
export type FillEvent = { type: "start"; slotIds: string[] } | { type: "draft"; slotId: string; text: string };

const SAMPLE = "A draft written from what you published appears here, in your voice, with the quote it rests on.";

/**
 * Fill the displayed week using either the person's key or the available built-in allowance.
 * The result says what was saved, what the playbook refused, and why.
 */
export function WriteWeekButton({ availability, count, inlineActions = false, example = false, week = "next", onWriting, onProgress, sampleIds = [] }: { availability: WritingAvailability; count: number; inlineActions?: boolean; example?: boolean; /** Which week the button fills. */ week?: "this" | "next"; /** Told when a run starts and ends, so the week can show the times being written. */ onWriting?: (writing: boolean) => void; /** Told what the run reports: the times it will write, each finished draft, and nothing more. */ onProgress?: (event: FillEvent) => void; /** The example's empty times, which it plays the run on without writing anything. */ sampleIds?: string[] }) {
  const [result, setResult] = useState<WriteWeekActionResult | null>(null);
  const [pending, start] = useTransition();
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ total: 0, written: 0, saving: false });
  const router = useRouter();
  const suggest = useNextSteps();
  const busy = pending || running;
  // onWriting is a state setter in the caller.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { onWriting?.(busy); }, [busy]);
  const report = (event: FillEvent | { type: "saving" }) => {
    if (event.type === "start") setProgress({ total: event.slotIds.length, written: 0, saving: false });
    if (event.type === "draft") setProgress((p) => ({ ...p, written: p.written + 1 }));
    if (event.type === "saving") setProgress((p) => ({ ...p, saving: true }));
    if (event.type !== "saving") onProgress?.(event);
  };
  const step = progress.saving ? "Checking each one against your playbook and saving to Buffer…"
    : !progress.total ? "Reading what you published…"
    : progress.written < progress.total ? `Writing draft ${progress.written + 1} of ${progress.total} in your voice…`
    : "Checking each one against your playbook…";

  /** Reads the run's report line by line; the last line is the result. */
  const fill = async (): Promise<WriteWeekActionResult> => {
    const failed: WriteWeekActionResult = { ok: false, message: "Could not write the drafts just now. Try again." };
    const res = await fetch("/api/week/fill", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ week }) }).catch(() => null);
    if (!res?.ok || !res.body) return failed;
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let rest = "";
    let result: WriteWeekActionResult | null = null;
    for (;;) {
      const { value, done } = await reader.read().catch(() => ({ value: undefined, done: true }));
      rest += value ?? "";
      const lines = rest.split("\n");
      rest = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        const event = JSON.parse(line);
        if (event.type === "done") result = event.result; else report(event);
      }
      if (done) break;
    }
    // The connection dropped before the result: the run goes on at the server, and the week shows what it saved.
    return result ?? { ok: false, message: "The connection dropped while the drafts were being written. The run finishes on its own; refresh the week in a minute to see them." };
  };
  /** The example plays a run on its own empty times and writes nothing. */
  const play = () => {
    setResult(null); setRunning(true);
    report({ type: "start", slotIds: sampleIds });
    sampleIds.forEach((slotId, i) => setTimeout(() => report({ type: "draft", slotId, text: SAMPLE }), 1800 * (i + 1)));
    setTimeout(() => report({ type: "saving" }), 1800 * sampleIds.length + 900);
    setTimeout(() => { setRunning(false); setProgress({ total: 0, written: 0, saving: false }); setResult({ ok: false, message: "That is how a week fills. This is the example account, so nothing was written. Sign in with Buffer and Queue Pilot fills your own empty times." }); }, 1800 * sampleIds.length + 3200);
  };

  if (!availability.ready) return <p style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>{availability.message} <a href="/settings?tab=ai#ai-key">AI settings</a></p>;
  if (!count) return <p style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>No empty times are left to fill {week === "this" ? "this week" : "next week"}.</p>;
  return (
    <div className={inlineActions ? styles.inline : styles.group}>
      <Button variant="secondary" size="lg" disabled={busy} onClick={() => example ? play() : start(async () => {
        setResult(null); setRunning(true); setProgress({ total: 0, written: 0, saving: false });
        const r = await fill();
        setRunning(false);
        setResult(r);
        suggest(await nextStepsAfterFill(r.ok ? r.saved.length : 0, r.ok ? undefined : r.reason).catch(() => []));
        router.refresh();
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
