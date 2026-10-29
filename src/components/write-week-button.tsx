"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { writeMyWeek, type WriteWeekActionResult } from "@/app/(app)/actions";
import { Alert } from "@/registry/components/alert/alert";
import { Button } from "@/registry/components/button/button";

/**
 * "Write drafts with my AI" on Next week, for people without a connected AI app. Without a saved key it points to
 * Settings. The result says what was saved, what the playbook refused, and why.
 */
export function WriteWeekButton({ hasKey }: { hasKey: boolean }) {
  const [result, setResult] = useState<WriteWeekActionResult | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  if (!hasKey) return <p style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>No AI app connected? <a href="/settings?tab=ai#ai-key">Add your AI key in Settings</a> and write the drafts here.</p>;
  return (
    <div style={{ display: "grid", gap: 12, justifyItems: "start" }}>
      <Button variant="secondary" disabled={pending} onClick={() => start(async () => {
        const r = await writeMyWeek();
        setResult(r);
        if (r.ok) router.refresh();
      })}>
        {pending ? "Writing drafts… this takes up to a minute" : "Write drafts with my AI"}
      </Button>
      {result && !result.ok && <Alert tone="danger" title="No drafts written">{result.message}</Alert>}
      {result && result.ok && (
        <Alert tone={result.refused.length || result.flags.length || result.note ? "warning" : "success"} title={`${result.saved.length} draft${result.saved.length === 1 ? "" : "s"} saved in Buffer`}>
          {result.retried > 0 && <p>{result.retried} draft{result.retried === 1 ? "" : "s"} broke a "do not save" rule in your playbook and {result.retried === 1 ? "was" : "were"} rewritten once.</p>}
          {result.refused.map((r) => <p key={r.slotId}>Not saved: {r.reason}</p>)}
          {result.flags.map((j, i) => <p key={i}>{j.verdict === "fail" ? "Check" : "Not sure"}: {j.where}, "{j.rule}"{j.reason ? `. ${j.reason}` : ""}</p>)}
          {result.note && <p>{result.note}</p>}
        </Alert>
      )}
    </div>
  );
}
