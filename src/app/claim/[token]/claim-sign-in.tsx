"use client";

import { useState } from "react";
import { authClient } from "@/lib/auth-client";
import styles from "./claim.module.css";

/** Sign in with Buffer and come straight back to this claim page. */
export function ClaimSignIn() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signIn() {
    setBusy(true);
    setError(null);
    const here = window.location.pathname;
    const res = await authClient.signIn.social({ provider: "buffer", callbackURL: here, errorCallbackURL: here });
    if (res.error) {
      setError("Buffer sign-in could not start. Please try again in a moment.");
      setBusy(false);
    }
  }

  return (
    <div className={styles.actions}>
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      <button type="button" className={styles.primary} onClick={signIn} disabled={busy}>
        {busy ? "Opening Buffer…" : "Sign in with Buffer to claim"}
      </button>
    </div>
  );
}
