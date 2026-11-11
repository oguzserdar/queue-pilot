"use client";

import type { ApprovedApp } from "@/lib/ai-access";
import type { WritingAvailability } from "@/lib/writing-availability";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setOfferAside } from "@/app/(app)/actions";
import { AiMark } from "./ai-mark";
import { CHAT_GUIDES } from "./connect-view";
import { HomeStart } from "./home-start";
import { SetupSteps, type SetupAccount } from "./setup-steps";
import styles from "./welcome-choice.module.css";

type Path = "own" | "built-in";

/**
 * Home's first visit: who writes the drafts. Two paths that both work: the person's own AI (recommended, since it can
 * read more of their work), set up with the same steps as Connect; or Queue Pilot's built-in AI writing from a link.
 * "Not now" sets the welcome aside for good; Connect stays in the sidebar.
 */
export function WelcomeChoice({ origin, account, approved, count, empty, hasSource, writing }: {
  origin: string;
  account: SetupAccount;
  approved: ApprovedApp[] | null;
  /** Empty times next week that one fill writes into (at most ten). */
  count: number;
  /** Every empty time next week, the same number Home's empty-times line shows. */
  empty: number;
  hasSource: boolean;
  writing: WritingAvailability;
}) {
  const [path, setPath] = useState<Path>("own");
  const [leaving, start] = useTransition();
  const router = useRouter();
  const live = account.channels.filter((c) => !c.disconnected).map((c) => c.name);

  return (
    <section className={styles.welcome} aria-labelledby="welcome-title">
      <header className={styles.head}>
        <h1 id="welcome-title" className={styles.title}>Let&apos;s fill your first week</h1>
        <p className={styles.sub}>{empty} empty time{empty === 1 ? "" : "s"} next week on {live.length} channel{live.length === 1 ? "" : "s"}</p>
      </header>

      <fieldset className={styles.choices}>
        <legend className="sr-only">Who writes your drafts</legend>
        <label className={styles.choice}>
          <input type="radio" name="welcome-path" value="own" checked={path === "own"} onChange={() => setPath("own")} className={styles.radio} />
          <span className={styles.choiceHead}>
            <strong>Use your own AI</strong>
            <span className={styles.badge}>Recommended</span>
          </span>
          <span className={styles.body}>Claude, ChatGPT, Grok or any MCP app writes your drafts from your email, docs and posts. Connect more than one to give it more to work with.</span>
          <span className={`${styles.marks} ${styles.foot}`} aria-hidden="true">{["Claude", "ChatGPT", "Grok", "MCP"].map((n) => <AiMark key={n} name={n} size={18} />)}</span>
        </label>
        <label className={styles.choice}>
          <input type="radio" name="welcome-path" value="built-in" checked={path === "built-in"} onChange={() => setPath("built-in")} className={styles.radio} />
          <span className={styles.choiceHead}><strong>Use Queue Pilot&apos;s AI</strong></span>
          <span className={styles.body}>Paste a link to your blog, newsletter or releases. We&apos;ll write from that.</span>
          <span className={styles.foot}>No setup needed</span>
        </label>
      </fieldset>

      {path === "own"
        ? <SetupSteps title="Connect your AI" origin={origin} account={account} approved={approved} example={false} guides={CHAT_GUIDES}
            openApp={(name) => router.push(`/connect?setup=${encodeURIComponent(name)}`)} />
        : <HomeStart hasSource={hasSource} writing={writing} count={count} aiLink={false} />}

      <button type="button" className={styles.later} disabled={leaving}
        onClick={() => start(async () => { await setOfferAside("welcome"); router.refresh(); })}>
        {leaving ? "One moment…" : "Not now"}
      </button>
    </section>
  );
}
