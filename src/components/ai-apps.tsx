"use client";

import { useState, useTransition } from "react";
import { revokeAiApp } from "@/app/(app)/actions";
import type { ApprovedApp } from "@/lib/ai-access";
import { Button } from "@/registry/components/button/button";
import { useToastStack } from "@/registry/components/toast-stack/toast-stack";
import styles from "./settings-view.module.css";

const day = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(new Date(iso));

/**
 * The AI apps allowed to use this account through the connector, each with Revoke. Revoking asks once, inline, and
 * takes effect on the app's next call.
 */
export function AiApps({ apps }: { apps: ApprovedApp[] | null }) {
  const [confirming, setConfirming] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const { toast } = useToastStack();

  if (apps === null) return <p className={styles.muted}>Queue Pilot could not load this list just now. Reload the page.</p>;
  if (apps.length === 0) return <p className={styles.muted}>No AI app can use your Queue Pilot. Connect one on the Connect page.</p>;
  return (
    <>
      <div className={styles.rows}>
        {apps.map((a) => (
          <div key={a.consentId} className={styles.row}>
            <div className={styles.name}>
              <strong>{a.name}</strong>
              <span className={styles.muted}>
                Allowed {day(a.approvedAt)}
                {a.site ? ` · ${a.site.replace(/^https?:\/\//, "")}` : ""}
              </span>
            </div>
            {confirming === a.consentId ? (
              <div className={styles.confirm}>
                <span className={styles.muted}>Stop {a.name} using your Buffer through Queue Pilot?</span>
                <Button
                  variant="danger"
                  size="sm"
                  disabled={pending}
                  onClick={() =>
                    start(async () => {
                      const r = await revokeAiApp(a.consentId);
                      setConfirming(null);
                      if (r.ok) { toast({ type: "success", title: `${a.name} can no longer use Queue Pilot.` }); setMessage(null); } else setMessage(r.message ?? "Something went wrong.");
                    })
                  }
                >
                  {pending ? "Revoking…" : "Revoke"}
                </Button>
                <Button variant="ghost" size="sm" disabled={pending} onClick={() => setConfirming(null)}>Cancel</Button>
              </div>
            ) : (
              <Button variant="secondary" size="sm" onClick={() => setConfirming(a.consentId)}>Revoke</Button>
            )}
          </div>
        ))}
      </div>
      {message && <p className={styles.problem} role="alert">{message}</p>}
    </>
  );
}
