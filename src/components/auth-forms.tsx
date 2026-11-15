"use client";
/**
 * @fileoverview The email account forms: sign in, create an account, forgot password, choose a new password. Built from
 * the Arc Input and Button. Every answer is worded so it never says whether an email has an account.
 */
import { useState, type FormEvent } from "react";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/registry/components/button/button";
import { Input } from "@/registry/components/input/input";
import styles from "@/app/sign-in/sign-in.module.css";

/** The password rules shown while typing; the server enforces the same length. */
const RULES = [
  { label: "At least 10 characters", ok: (p: string) => p.length >= 10 },
  { label: "Not only letters", ok: (p: string) => /[^A-Za-z]/.test(p) },
];

function PasswordRules({ password }: { password: string }) {
  return (
    <ul className={styles.rules} aria-label="Password rules">
      {RULES.map((r) => <li key={r.label} data-ok={r.ok(password) || undefined}>{r.label}</li>)}
    </ul>
  );
}

const strong = (p: string) => RULES.every((r) => r.ok(p));

/** Email and password sign-in, with links to create an account and reset the password. */
export function EmailSignIn() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null); setNotice(null);
    const res = await authClient.signIn.email({ email, password, callbackURL: "/" });
    setBusy(false);
    if (!res.error) return;
    if (res.error.status === 403) setNotice("Confirm your email first. We just sent a new link to it.");
    else if (res.error.status === 429) setError("Too many tries. Wait a minute and try again.");
    else setError("That email and password do not match an account.");
  }

  return (
    <form className={styles.form} onSubmit={submit} noValidate>
      <Input label="Email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      <Input label="Password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      {notice ? <p className={styles.notice} role="status">{notice}</p> : null}
      <Button type="submit" variant="secondary" loading={busy} disabled={!email || !password}>Sign in</Button>
      <p className={styles.links}><a href="/forgot-password">Forgot your password?</a><span aria-hidden="true">·</span><a href="/sign-up">Create an account</a></p>
    </form>
  );
}

/** Create an account with a name, email and password; the account works after the emailed link is opened. */
export function EmailSignUp() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!strong(password)) return setError("Choose a password that meets both rules.");
    setBusy(true); setError(null);
    const res = await authClient.signUp.email({ name: name.trim() || email.split("@")[0], email, password, callbackURL: "/" });
    setBusy(false);
    if (res.error) setError(res.error.status === 429 ? "Too many tries. Wait a minute and try again." : "That did not work. Check the email address and try again.");
    else setSentTo(email);
  }

  if (sentTo) {
    return (
      <div className={styles.form} role="status">
        <h2 className={styles.step}>Check your email</h2>
        <p className={styles.sub}>We sent a link to <strong>{sentTo}</strong>. Open it to finish creating your account. It works for one hour.</p>
        <p className={styles.small}>Nothing arrived? Check spam, or <a href="/sign-in">sign in</a> to get a new link.</p>
      </div>
    );
  }
  return (
    <form className={styles.form} onSubmit={submit} noValidate>
      <Input label="Your name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
      <Input label="Email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      <Input label="Password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      <PasswordRules password={password} />
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      <Button type="submit" variant="primary" loading={busy} disabled={!email || !strong(password)}>Create account</Button>
      <p className={styles.links}>Already have an account? <a href="/sign-in">Sign in</a></p>
    </form>
  );
}

/** Ask for a reset link. The answer is the same whether or not the email has an account. */
export function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    const res = await authClient.requestPasswordReset({ email, redirectTo: "/reset-password" });
    setBusy(false);
    if (res.error && res.error.status === 429) setError("Too many tries. Wait a minute and try again.");
    else setDone(true);
  }

  if (done) {
    return (
      <div className={styles.form} role="status">
        <h2 className={styles.step}>Check your email</h2>
        <p className={styles.sub}>If <strong>{email}</strong> has a Queue Pilot account, a link to choose a new password is on its way. It works for one hour.</p>
        <p className={styles.small}><a href="/sign-in">Back to sign in</a></p>
      </div>
    );
  }
  return (
    <form className={styles.form} onSubmit={submit} noValidate>
      <Input label="Email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      <Button type="submit" variant="primary" loading={busy} disabled={!email}>Send reset link</Button>
      <p className={styles.links}><a href="/sign-in">Back to sign in</a></p>
    </form>
  );
}

/** Choose a new password from the emailed link; the token arrives in the address. */
export function ResetPassword({ token, invalid }: { token: string | null; invalid: boolean }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(invalid || !token ? "This link has expired or was already used. Ask for a new one." : null);
  const [done, setDone] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!token) return;
    setBusy(true); setError(null);
    const res = await authClient.resetPassword({ newPassword: password, token });
    setBusy(false);
    if (res.error) setError("This link has expired or was already used. Ask for a new one.");
    else setDone(true);
  }

  if (done) {
    return (
      <div className={styles.form} role="status">
        <h2 className={styles.step}>Password changed</h2>
        <p className={styles.sub}>You were signed out everywhere else. Sign in with your new password.</p>
        <p><a className={styles.cta} href="/sign-in">Sign in</a></p>
      </div>
    );
  }
  if (!token || invalid) {
    return (
      <div className={styles.form}>
        <p className={styles.error} role="alert">{error}</p>
        <p className={styles.links}><a href="/forgot-password">Send a new link</a></p>
      </div>
    );
  }
  return (
    <form className={styles.form} onSubmit={submit} noValidate>
      <Input label="New password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      <PasswordRules password={password} />
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      <Button type="submit" variant="primary" loading={busy} disabled={!strong(password)}>Save new password</Button>
    </form>
  );
}
