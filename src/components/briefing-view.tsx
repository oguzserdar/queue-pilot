"use client";

import { useState } from "react";
import { Button } from "@/registry/components/button/button";
import styles from "./briefing-view.module.css";

type Idea = { id: string; foundBy: string; title: string; why: string; link: string; slot?: string };

const IDEAS: Idea[] = [
  { id: "i1", foundBy: "Your newsletter", title: "Weeknight Dinners 41: white bean and kale soup", why: "Sent Sunday and not posted yet", link: "weeknightdinners.example/41", slot: "4 drafts: Tue 27 to Thu 29" },
  { id: "i2", foundBy: "Your newsletter", title: "Weeknight Dinners 39: three pantry swaps", why: "Posted once on LinkedIn, never on the others", link: "weeknightdinners.example/39", slot: "a draft: Thu 29, LinkedIn, 15:00" },
  { id: "i3", foundBy: "Your YouTube", title: "Knife skills in five minutes", why: "New video, no open time left this week", link: "youtube.example/weeknightdinners" },
];

/** Example mode shows what is new in the example feeds; live mode says what works today: the AI reads the user's feeds through the connector. */
export function BriefingView({ mode = "example" }: { mode?: "example" | "live" }) {
  // Hooks run before any early return, so switching mode never changes the hook order.
  const [saved, setSaved] = useState<Set<string>>(new Set());
  if (mode === "live") {
    return (
      <div className={styles.page}>
        <header className={styles.head}>
          <h1 className={styles.title}>New material comes from your feeds</h1>
          <p className={styles.sub}>Add your newsletter, blog, YouTube or GitHub releases feed in Sources. Then pick "Fill my week" in your AI: it reads what is new, writes drafts for the empty slots, and saves them in Buffer for you to approve.</p>
        </header>
        <a className={styles.action} href="/sources">Add a feed in Sources</a>
      </div>
    );
  }
  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <h1 className={styles.title}>3 new things in your own work</h1>
        <p className={styles.sub}>Queue Pilot reads your newsletter and YouTube feeds. New pieces become drafts in empty times. A piece without a time waits in Buffer Ideas.</p>
      </header>

      <ol className={styles.list}>
        {IDEAS.map((idea) => (
          <li key={idea.id} className={styles.item}>
            <div className={styles.main}>
              <span className={styles.by}>{idea.foundBy}</span>
              <h2 className={styles.h2}>{idea.title}</h2>
              <p className={styles.why}><span className={styles.label}>Why now</span>{" "}{idea.why}</p>
              <span className={styles.link}>{idea.link}</span>
            </div>
            <div className={styles.side}>
              {idea.slot ? (
                <p className={styles.slot}><span className={styles.mark} aria-hidden="true" />In {idea.slot}</p>
              ) : (
                <Button variant="secondary" size="sm" disabled={saved.has(idea.id)} onClick={() => setSaved((s) => new Set(s).add(idea.id))}>
                  {saved.has(idea.id) ? "Saved to Buffer Ideas" : "Save to Buffer Ideas"}
                </Button>
              )}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
