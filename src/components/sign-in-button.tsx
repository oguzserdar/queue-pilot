"use client";

import { useState, type ReactNode } from "react";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/registry/components/button/button";

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
    const back = new URL(returnTo ?? `${window.location.pathname}${window.location.search}`, window.location.origin);
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
