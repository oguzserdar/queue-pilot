"use client";

import { useState, useSyncExternalStore } from "react";
import { authClient } from "@/lib/auth-client";
import { SignInNotice } from "@/components/sign-in-button";
import { withoutSignInError } from "@/lib/sign-in-errors";
import { EmailSignIn } from "@/components/auth-forms";
import styles from "./sign-in.module.css";

/** An AI app's connect request carries its client_id in the address. */
const aiConnecting = () => new URLSearchParams(window.location.search).has("client_id");
const notOnServer = () => false;
const noEvents = () => () => {};

/** The line under the title: what an AI asking to connect may do, or how this deployment signs people in. */
function introLine(connecting: boolean, emailEnabled: boolean): string {
  if (connecting) return "Your AI is asking to work with your Buffer queue. Sign in with Buffer first; on the next screen you will see what it may do, and allow or deny it.";
  return emailEnabled ? "Your own AI writes your posts in your voice, under your rules. Sign in with Buffer to work on your Buffer queue, or with email." : "Queue Pilot reads your Buffer queue and puts your own AI to work on its empty times.";
}

/** Sign in with Buffer, or with email when the server can send mail. Also the login step when an AI asks to connect. */
export function SignInView({ emailEnabled }: { emailEnabled: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Read after mount: the server cannot see the query string the AI added, so both renders start the same.
  const connecting = useSyncExternalStore(noEvents, aiConnecting, notOnServer);

  async function signIn() {
    setBusy(true);
    setError(null);
    // A failed sign-in comes back here with ?error=, which the notice explains; an AI's connect request keeps its query.
    const here = withoutSignInError(new URL(window.location.href));
    const res = await authClient.signIn.social({ provider: "buffer", callbackURL: connecting ? undefined : "/", errorCallbackURL: here.pathname + here.search });
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
        {introLine(connecting, emailEnabled)}
      </p>
      <SignInNotice />
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      <button type="button" className={styles.cta} onClick={signIn} disabled={busy}>
        {busy ? "Opening Buffer…" : "Sign in with Buffer"}
      </button>
      {emailEnabled ? (
        <>
          <div className={styles.divider} role="separator"><span>or with email</span></div>
          <EmailSignIn />
        </>
      ) : null}
      <p className={styles.small}>Built on the Buffer API. Queue Pilot is not made by Buffer.</p>
      <p className={styles.small}><a href="/privacy">Privacy: what Queue Pilot stores and shares</a></p>
    </main>
  );
}
