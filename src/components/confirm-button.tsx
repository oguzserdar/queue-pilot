"use client";

import { useState, type ReactNode } from "react";
import { Button } from "@/registry/components/button/button";
import styles from "./confirm-button.module.css";

/**
 * A button for something that cannot be taken back: the first press asks in place ("Delete this rule?"), and only the
 * red confirm does it. Focus lands on Cancel, so Enter alone never destroys anything; Cancel or Escape leaves everything as it was.
 */
export function ConfirmButton({ label, question, confirmLabel, onConfirm, pending = false, ariaLabel, variant = "ghost" }: {
  label: ReactNode;
  question: string;
  confirmLabel: string;
  onConfirm: () => void;
  pending?: boolean;
  ariaLabel?: string;
  variant?: "ghost" | "secondary";
}) {
  const [asking, setAsking] = useState(false);
  if (!asking) return <Button variant={variant} size="sm" aria-label={ariaLabel} disabled={pending} onClick={() => setAsking(true)}>{label}</Button>;
  return (
    <span className={styles.confirm} role="group" aria-label={question} onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); setAsking(false); } }}>
      <span className={styles.question}>{question}</span>
      <Button variant="danger" size="sm" disabled={pending} onClick={() => { onConfirm(); setAsking(false); }}>{confirmLabel}</Button>
      <Button variant="ghost" size="sm" autoFocus disabled={pending} onClick={() => setAsking(false)}>Cancel</Button>
    </span>
  );
}
