"use client";

import { useEffect, useState } from "react";
import { authClient } from "@/lib/auth-client";
import styles from "./sign-in.module.css";

/** Sign in with Buffer. Used directly and as the login step when an AI asks to connect to Queue Pilot. */
export default function SignInPage() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Read after mount: the server cannot see the query string the AI added, so both renders start the same.
  const [connecting, setConnecting] = useState(false);
  useEffect(() => setConnecting(new URLSearchParams(window.location.search).has("client_id")), []);

  async function signIn() {
    setBusy(true);
    setError(null);
    const res = await authClient.signIn.social({ provider: "buffer", callbackURL: connecting ? undefined : "/" });
    if (res.error) {
      setError("Buffer sign-in could not start. Please try again in a moment.");
      setBusy(false);
    }
  }

  return (
    <main className={styles.page}>
      <div className={styles.mark}>Queue Pilot<span>.</span></div>
      <h1 className={styles.title}>{connecting ? "Sign in to connect your AI" : "Sign in to Queue Pilot"}</h1>
      <p className={styles.sub}>
        {connecting
          ? "Your AI is asking to work with your Buffer queue. Sign in with Buffer first; you will choose what it may do on the next screen."
          : "Queue Pilot reads your Buffer queue and puts your own AI to work on its empty slots."}
      </p>
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      <button type="button" className={styles.cta} onClick={signIn} disabled={busy}>
        {busy ? "Opening Buffer…" : "Sign in with Buffer"}
      </button>
      <p className={styles.small}>Built on the Buffer API. Queue Pilot is not made by Buffer.</p>
    </main>
  );
}
