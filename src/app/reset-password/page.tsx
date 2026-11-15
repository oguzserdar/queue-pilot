import { redirect } from "next/navigation";
import { ResetPassword } from "@/components/auth-forms";
import { mailConfig } from "@/lib/mail";
import styles from "../sign-in/sign-in.module.css";

export const dynamic = "force-dynamic";

/** Choose a new password. The emailed link lands here with ?token=, or with ?error= when it expired or was used. */
export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string; error?: string }> }) {
  if (!mailConfig()) redirect("/sign-in");
  const { token, error } = await searchParams;
  return (
    <main className={styles.page}>
      <div className={styles.mark}>Queue Pilot<span>.</span></div>
      <h1 className={styles.title}>Choose a new password</h1>
      <ResetPassword token={token ?? null} invalid={!!error} />
    </main>
  );
}
