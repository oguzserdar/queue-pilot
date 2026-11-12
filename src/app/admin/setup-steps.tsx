import { SignInButton } from "@/components/sign-in-button";
import { Button } from "@/registry/components/button/button";
import { PasswordField } from "@/registry/components/password-field/password-field";
import { MIN_SETUP_CODE } from "@/lib/admin-setup-code";
import { claimAdmin } from "./actions";
import styles from "./admin.module.css";

/** How an operator gets admin back without the web claim: the deployment's settings, or a command on the server. */
export function AdminRecovery() {
  return (
    <p className={styles.help}>
      To become the admin, set <code className={styles.code}>ADMIN_SETUP_CODE</code> ({MIN_SETUP_CODE} characters or more) in
      this deployment&apos;s settings and claim it here while it has no admin, or run{" "}
      <code className={styles.code}>pnpm admin:grant you@example.com</code> against its database. Existing admins stay admins.
    </p>
  );
}

/**
 * First-run setup, two numbered steps: sign in with Buffer, then claim the deployment. A done step shows its tick. In
 * production the claim needs the setup code; without a usable one the claim button is not offered and the recovery
 * steps are shown instead.
 */
export function SetupSteps({ email, needsCode, ready, problem }: { email: string | null; needsCode: boolean; ready: boolean; problem?: string }) {
  return (
    <section className={styles.setup} aria-labelledby="setup-title">
      <p className={styles.mark}>Queue Pilot<span>.</span></p>
      <h1 id="setup-title" className={styles.title}>Set up Queue Pilot</h1>
      <p className={styles.sub}>Two steps, once. The person who finishes them runs this deployment and manages its keys.</p>
      <ol className={styles.steps}>
        <li className={styles.step} data-done={email ? "true" : undefined}>
          <span className={styles.num} aria-hidden="true">{email ? "✓" : "1"}</span>
          <div className={styles.stepBody}>
            <strong>Sign in with Buffer</strong>
            {email ? <span className={styles.muted}>Signed in as {email}</span> : <SignInButton variant="primary" size="md" returnTo="/admin" />}
          </div>
        </li>
        <li className={styles.step} data-current={email ? "true" : undefined}>
          <span className={styles.num} aria-hidden="true">2</span>
          <div className={styles.stepBody}>
            <strong>Become the admin</strong>
            <span className={styles.muted}>Only one person can claim a new deployment. More admins are added later from the server.</span>
            {!ready ? (
              <>
                <p className={styles.error} role="alert">This deployment has no setup code, so nobody can claim it from the web.</p>
                <AdminRecovery />
              </>
            ) : email ? (
              <form action={claimAdmin} className={styles.field}>
                {needsCode ? <PasswordField name="code" label="Setup code" description="The ADMIN_SETUP_CODE value from this deployment's settings." autoComplete="off" required /> : null}
                <Button type="submit" variant="primary" size="md">Become the admin</Button>
              </form>
            ) : null}
            {problem === "code" ? <p className={styles.error} role="alert">That setup code does not match this deployment&apos;s.</p> : null}
          </div>
        </li>
      </ol>
    </section>
  );
}
