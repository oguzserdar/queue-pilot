"use client";

import { useState, useTransition } from "react";
import { signOutOtherDevices } from "@/app/(app)/actions";
import { Button } from "@/registry/components/button/button";
import { useToastStack } from "@/registry/components/toast-stack/toast-stack";
import styles from "./settings-view.module.css";

/** A browser signed in to this account. */
export type Device = { id: string; device: string; lastActive: string; current: boolean };

// Sessions refresh their timestamp about once a day, so only the date is meaningful.
const when = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(new Date(iso));

/** Browsers signed in to this Queue Pilot account, and one button that signs out all but this one. */
export function SignedInDevices({ devices }: { devices: Device[] | null }) {
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const { toast } = useToastStack();
  if (devices === null) return <p className={styles.muted}>Queue Pilot could not load this list just now. Reload the page.</p>;
  const others = devices.filter((d) => !d.current).length;
  return (
    <>
      <div className={styles.rows}>
        {devices.map((d) => (
          <div key={d.id} className={styles.row}>
            <div className={styles.name}>
              <strong>{d.device}</strong>
              <span className={styles.muted}>{d.current ? "This browser" : `Last active ${when(d.lastActive)}`}</span>
            </div>
          </div>
        ))}
      </div>
      {others > 0 && (
        <div className={styles.deviceActions}>
          <Button
            variant="secondary"
            size="sm"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await signOutOtherDevices();
                if (r.ok) { toast({ type: "success", title: "Signed out everywhere else." }); setMessage(null); } else setMessage(r.message ?? "Something went wrong.");
              })
            }
          >
            {pending ? "Signing out…" : `Sign out the other ${others === 1 ? "browser" : `${others} browsers`}`}
          </Button>
        </div>
      )}
      {message && <p className={styles.problem} role="alert">{message}</p>}
    </>
  );
}
