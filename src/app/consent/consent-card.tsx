import type { ReactNode } from "react";
import { Check, Link2 } from "lucide-react";
import { AiMark } from "@/components/ai-mark";
import styles from "./consent.module.css";

/** Plain-language meaning of each scope an AI client may ask for. Unknown scopes are listed as-is. */
const SCOPE_TEXT: Record<string, string> = {
  openid: "Know which Queue Pilot account you are",
  profile: "See your name and picture",
  email: "See your email address",
  offline_access: "Stay connected until you disconnect it",
};

/** Shared permission presentation; authorization remains in the page and consent action. */
export function ConsentCard({ client, user, scopes, children }: { client: string; user: { name: string; email: string; image?: string | null }; scopes: string[]; children: ReactNode }) {
  // Match the exact metadata host, never a partial name or a caller-provided redirect URL.
  const brand = client === "claude.ai" ? "Claude" : client === "chatgpt.com" ? "ChatGPT" : null;
  const { name, email, image } = user;
  return (
    <main className={styles.page}>
      <section className={styles.card} aria-labelledby="consent-title">
        {/* The asking app and Queue Pilot side by side, the way sign-in consent screens show who connects to whom. */}
        <div className={styles.pair} aria-hidden="true">
          <span className={styles.clientTile}>{brand ? <AiMark name={brand} size={32} /> : client.replace(/^www\./, "").charAt(0).toUpperCase()}</span>
          <span className={styles.link}><Link2 size={16} strokeWidth={2} /></span>
          {/* eslint-disable-next-line @next/next/no-img-element -- a fixed local icon, no optimisation needed */}
          <img className={styles.appTile} src="/icon-192.png" alt="" width={56} height={56} />
        </div>
        <h1 id="consent-title" className={styles.title}><strong>{brand ?? client}</strong> wants to connect to Queue Pilot</h1>
        <div className={styles.account}>
          {image
            ? /* eslint-disable-next-line @next/next/no-img-element -- the person's own Buffer picture */ <img className={styles.avatar} src={image} alt="" width={32} height={32} />
            : <span className={styles.avatar} aria-hidden="true">{(name || email).charAt(0).toUpperCase()}</span>}
          <span className={styles.who}><span className={styles.name}>{name || email}</span>{name ? <span className={styles.email}>{email}</span> : null}</span>
        </div>
        <div className={styles.can}>
          <p className={styles.canTitle}>It will be able to</p>
          <ul className={styles.scopes}>
            <li><Check size={16} strokeWidth={2.5} aria-hidden="true" />Read your posting slots and posts</li>
            <li><Check size={16} strokeWidth={2.5} aria-hidden="true" />Read and update your writing voice, playbook and sources</li>
            <li><Check size={16} strokeWidth={2.5} aria-hidden="true" />Create, edit and delete drafts Queue Pilot wrote</li>
            {scopes.map((s) => <li key={s}><Check size={16} strokeWidth={2.5} aria-hidden="true" />{SCOPE_TEXT[s] ?? s}</li>)}
          </ul>
        </div>
        <p className={styles.note}>It cannot schedule or publish anything. Only your Approve schedules a post.</p>
        {children}
      </section>
    </main>
  );
}
