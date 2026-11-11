"use client";

import Link from "next/link";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { setOfferAside } from "@/app/(app)/actions";
import { AiMark } from "./ai-mark";
import styles from "./ai-offer.module.css";

/** What a second AI adds, by the name the app picker uses. Only claims each app's own connectors support. */
const ADDS: Record<string, string> = {
  Grok: "can bring in what you post on X.",
  Claude: "can bring in your Gmail, Drive and GitHub through its connectors.",
};

/**
 * A small card on Home that offers the person's own AI. With none connected it says what their own AI adds over the
 * links Queue Pilot reads; with one connected it suggests the next AI that would see more of their work. × sets it
 * aside for good, and Connect stays in the sidebar.
 */
export function AiOffer({ connected }: {
  /** Brands of the AI apps that have really called Queue Pilot, newest first. */
  connected: string[];
}) {
  const [hiding, start] = useTransition();
  const router = useRouter();
  const next = connected.length ? Object.keys(ADDS).find((n) => !connected.includes(n)) : undefined;
  if (connected.length && !next) return null;
  const key = connected.length ? "add-ai" : "connect-ai";

  return (
    <aside className={styles.offer} aria-labelledby="ai-offer-title">
      <div className={styles.text}>
        <h2 id="ai-offer-title" className={styles.title}>{next ? "Add another AI" : "Get better drafts with your own AI"}</h2>
        <p className={styles.body}>{next ? `${connected[0]} is connected. ${next} ${ADDS[next]}` : "Your AI can draft from your email, docs and posts too."}</p>
      </div>
      <div className={styles.actions}>
        <span className={styles.marks} aria-hidden="true">{(next ? [next] : ["Claude", "ChatGPT", "Grok", "MCP"]).map((n) => <AiMark key={n} name={n} size={18} />)}</span>
        <Link href={next ? `/connect?setup=${encodeURIComponent(next)}` : "/connect"} className={styles.connect}>{next ? `Add ${next}` : "Connect your AI"}</Link>
      </div>
      <button type="button" className={styles.hide} aria-label="Hide AI suggestion" disabled={hiding}
        onClick={() => start(async () => { await setOfferAside(key); router.refresh(); })}>×</button>
    </aside>
  );
}
