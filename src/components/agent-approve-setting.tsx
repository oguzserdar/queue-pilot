"use client";

import { useState, useTransition } from "react";
import { setAgentApproveMode } from "@/app/(app)/actions";
import type { ApproveMode } from "@/lib/agent-permission";
import SegmentedControl from "@/registry/components/segmented-control/segmented-control";
import styles from "./settings-view.module.css";

const HELP: Record<ApproveMode, string> = {
  ask: "Your AI shows you the exact drafts and schedules them only after you say yes in the chat.",
  direct: "Your AI schedules drafts when you ask it to, without a confirm step. It never schedules on its own.",
  off: "Your AI can write and fix drafts. Only you schedule them, here or in Buffer.",
};

/** Settings → AI: whether ChatGPT or Claude may approve drafts, and whether they must ask first. Saves on change. */
export function AgentApproveSetting({ mode: initial, example }: { mode: ApproveMode; example?: boolean }) {
  const [mode, setMode] = useState<ApproveMode>(initial);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const change = (next: string) => {
    const before = mode;
    setMode(next as ApproveMode);
    setMessage(null);
    if (example) { setMode(before); setMessage({ ok: false, text: "Sign in with Buffer first." }); return; }
    start(async () => {
      const r = await setAgentApproveMode(next).catch(() => ({ ok: false as const, message: "That didn't save. Try again." }));
      if (r.ok) setMessage({ ok: true, text: "Saved." });
      else { setMode(before); setMessage({ ok: false, text: r.message }); }
    });
  };
  return (
    <div className={styles.approveSetting} aria-busy={pending}>
      <SegmentedControl label="Approving drafts from your AI" value={mode} onValueChange={change} options={[
        { value: "ask", label: "Ask me first" },
        { value: "direct", label: "Don't ask" },
        { value: "off", label: "Only me" },
      ]} />
      <p className={styles.muted}>{HELP[mode]}</p>
      {message && <p role="status" className={message.ok ? styles.saved : styles.error}>{message.text}</p>}
    </div>
  );
}
