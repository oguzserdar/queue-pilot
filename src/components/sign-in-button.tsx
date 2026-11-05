"use client";

import { useEffect, useState, type ReactNode } from "react";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/registry/components/button/button";
import { Alert } from "@/registry/components/alert/alert";
import { signInProblem, withoutSignInError, type SignInProblem } from "@/lib/sign-in-errors";

/**
 * Goes straight to Buffer's sign-in in one click and comes back to the page it was pressed on (or `returnTo`).
 * Buffer is the only way in, so there is no page in between; /sign-in remains only for an AI app connecting to
 * Queue Pilot.
 */
export function SignInButton({ children = "Sign in with Buffer", returnTo, className, variant = "secondary", size = "sm" }: {
  children?: ReactNode;
  returnTo?: string;
  className?: string;
  variant?: "primary" | "secondary";
  size?: "sm" | "md" | "lg";
}) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const start = async () => {
    setBusy(true);
    setProblem(null);
    // An old ?error= from a failed attempt must not ride along and greet the person after this one succeeds.
    const back = withoutSignInError(new URL(returnTo ?? `${window.location.pathname}${window.location.search}`, window.location.origin));
    try {
      const { error } = await authClient.signIn.social({ provider: "buffer", callbackURL: back.toString() });
      if (error) {
        setProblem(error.status >= 500 ? "Buffer sign-in is not set up on this deployment yet." : "Buffer sign-in could not start. Try again in a moment.");
        setBusy(false);
      }
    } catch {
      setProblem("Buffer sign-in could not start. Try again in a moment.");
      setBusy(false);
    }
  };
  const label = busy ? "Opening Buffer…" : children;
  return (
    <>
      <Button variant={variant} size={size} className={className} onClick={start} disabled={busy}>{label}</Button>
      {problem && <span role="alert">{problem}</span>}
    </>
  );
}

/**
 * Shows why a Buffer sign-in failed when the page was reached with ?error=<code>, then removes the error from the
 * address so a refresh or a later sign-in does not show it again. Renders nothing otherwise.
 */
export function SignInNotice() {
  const [problem, setProblem] = useState<SignInProblem | null>(null);
  useEffect(() => {
    const url = new URL(window.location.href);
    const found = signInProblem(url.searchParams.get("error"));
    if (!found) return;
    setProblem(found);
    window.history.replaceState(window.history.state, "", withoutSignInError(url).toString());
  }, []);
  if (!problem) return null;
  return <Alert tone="danger" title={problem.title} style={{ marginBottom: 24 }} onDismiss={() => setProblem(null)}>{problem.text}</Alert>;
}
