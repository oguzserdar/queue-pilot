"use client";

import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/registry/components/button/button";
import { Alert } from "@/registry/components/alert/alert";
import { signInProblem, withoutSignInError, type SignInProblem } from "@/lib/sign-in-errors";

/**
 * Goes straight to Buffer's sign-in in one click and comes back to the page it was pressed on (or `returnTo`).
 * Buffer is the only way in, so there is no page in between; /sign-in remains only for an AI app connecting to
 * Queue Pilot.
 */
export function SignInButton({ children = "Sign in with Buffer", returnTo, className, variant = "secondary", size = "sm", say }: {
  children?: ReactNode;
  returnTo?: string;
  className?: string;
  variant?: "primary" | "secondary";
  size?: "sm" | "md" | "lg";
  /** What the home page's Pilot says while the button is hovered. */
  say?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const start = async () => {
    setBusy(true);
    setProblem(null);
    // An old ?error= from a failed attempt must not ride along and greet the person after this one succeeds.
    const back = withoutSignInError(new URL(returnTo ?? `${window.location.pathname}${window.location.search}`, window.location.origin));
    try {
      const { error } = await authClient.signIn.social({ provider: "buffer", callbackURL: back.toString(), errorCallbackURL: back.toString() });
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
      <Button variant={variant} size={size} className={className} onClick={start} disabled={busy} data-pilot-say={say}>{label}</Button>
      {problem && <span role="alert">{problem}</span>}
    </>
  );
}

/**
 * The sign-in problem this address was opened with, read once per address. After the notice cleans the error out of
 * the address it records the clean address with the same problem, so the notice stays until it is dismissed.
 */
let readFor: { href: string; problem: SignInProblem | null } | null = null;
function addressProblem(): SignInProblem | null {
  const href = window.location.href;
  if (readFor?.href !== href) readFor = { href, problem: signInProblem(new URL(href).searchParams.get("error")) };
  return readFor.problem;
}
/** The server renders no notice; the browser reads its own address. */
const noProblemOnServer = () => null;
/** The address is read when the notice renders; it does not need waking. */
const noAddressEvents = () => () => {};

/**
 * Shows why a Buffer sign-in failed when the page was reached with ?error=<code>, then removes the error from the
 * address so a refresh or a later sign-in does not show it again. Renders nothing otherwise.
 */
export function SignInNotice() {
  const found = useSyncExternalStore(noAddressEvents, addressProblem, noProblemOnServer);
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    if (!found) return;
    const clean = withoutSignInError(new URL(window.location.href)).toString();
    readFor = { href: clean, problem: found };
    window.history.replaceState(window.history.state, "", clean);
    // A later visit to this page reads its address afresh.
    return () => { readFor = null; };
  }, [found]);
  if (!found || dismissed) return null;
  return <Alert tone="danger" title={found.title} style={{ marginBottom: 24 }} onDismiss={() => setDismissed(true)}>{found.text}</Alert>;
}
