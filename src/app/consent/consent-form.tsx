"use client";

import { useState } from "react";
import { authClient } from "@/lib/auth-client";
import styles from "./consent.module.css";

/** Allow or Deny. The client plugin sends the signed oauth_query, so the server ties the answer to this exact request. */
export function ConsentForm() {
  const [busy, setBusy] = useState<"allow" | "deny" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function answer(accept: boolean) {
    setBusy(accept ? "allow" : "deny");
    setError(null);
    const res = await authClient.oauth2.consent({ accept });
    if (res.error) {
      setError("That did not go through. Start connecting again from your AI.");
      setBusy(null);
    }
  }

  return (
    <div className={styles.actions}>
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      <button type="button" className={styles.allow} onClick={() => answer(true)} disabled={busy !== null}>
        {busy === "allow" ? "Connecting…" : "Allow"}
      </button>
      <button type="button" className={styles.deny} onClick={() => answer(false)} disabled={busy !== null}>
        Deny
      </button>
    </div>
  );
}
