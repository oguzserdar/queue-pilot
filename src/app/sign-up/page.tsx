import { redirect } from "next/navigation";
import { EmailSignUp } from "@/components/auth-forms";
import { mailConfig } from "@/lib/mail";
import styles from "../sign-in/sign-in.module.css";

export const dynamic = "force-dynamic";

/** Create an account with email. Without a mail sender on this server there are no email accounts, so it goes to sign-in. */
export default function SignUpPage() {
  if (!mailConfig()) redirect("/sign-in");
  return (
    <main className={styles.page}>
      <div className={styles.mark}>Queue Pilot<span>.</span></div>
      <h1 className={styles.title}>Create your account</h1>
      <p className={styles.sub}>Your own AI writes your posts in your voice, under your rules. Nothing is posted until you say so.</p>
      <EmailSignUp />
    </main>
  );
}
