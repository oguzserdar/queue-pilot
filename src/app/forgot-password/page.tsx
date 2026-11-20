import { redirect } from "next/navigation";
import { ForgotPassword } from "@/components/auth-forms";
import { mailConfig } from "@/lib/mail";
import styles from "../sign-in/sign-in.module.css";

export const dynamic = "force-dynamic";

/** Ask for a password reset link. */
export default function ForgotPasswordPage() {
  if (!mailConfig()) redirect("/sign-in");
  return (
    <main className={styles.page}>
      <div className={styles.mark}>Queue Pilot<span>.</span></div>
      <h1 className={styles.title}>Reset your password</h1>
      <p className={styles.sub}>Type your email and we will send you a link to choose a new password.</p>
      <ForgotPassword />
    </main>
  );
}
