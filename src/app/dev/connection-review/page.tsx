import { notFound } from "next/navigation";
import { ConsentCard } from "@/app/consent/consent-card";
import styles from "@/app/consent/consent.module.css";

/** Development-only layout review with fictional identity and disabled consent controls. */
export default async function Page({ searchParams }: { searchParams: Promise<{ client?: string }> }) {
  if (process.env.NODE_ENV === "production") notFound();
  const client = (await searchParams).client === "chatgpt" ? "chatgpt.com" : "claude.ai";
  return <ConsentCard client={client} user={{ name: "Mark Evans", email: "mark@weeknightdinners.example" }} scopes={["openid", "profile", "email", "offline_access"]}>
    <p className={styles.note}>Development preview · Example account · Buttons disabled</p>
    <div className={styles.actions}><button className={styles.deny} disabled>Deny</button><button className={styles.allow} disabled>Allow</button></div>
  </ConsentCard>;
}
