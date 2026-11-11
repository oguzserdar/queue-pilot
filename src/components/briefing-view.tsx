"use client";

import { useState } from "react";
import { Button } from "@/registry/components/button/button";
import styles from "./briefing-view.module.css";
import { DEMO_BASE_START, DEMO_TIME_ZONE } from "@/lib/demo-clock";
import { BufferIdeasBoard } from "./buffer-ideas-board";
import type { IdeaBoard } from "@/app/(app)/idea-actions";

type Idea = { id: string; foundBy: string; title: string; why: string; link: string; slot?: string };

/** "Tue 17": a day of the example's shown week, which moves on with the calendar like the Week page. */
const weekDay = (shift: number, day: number) => new Date(Date.parse(DEMO_BASE_START) + (shift + day) * 86_400_000 + 12 * 3_600_000)
  .toLocaleDateString("en-GB", { weekday: "short", day: "numeric", timeZone: DEMO_TIME_ZONE }).replace(",", "");

/** The example ideas for a shown week; the shift comes from the server, so server and browser agree on the dates. */
const ideas = (shift: number): Idea[] => [
  { id: "i1", foundBy: "Your newsletter", title: "This Week in AI 41: Terra, Carbon, and 40 agents in Android Studio", why: "Sent Sunday and not posted yet", link: "thisweekinai.example/41", slot: `4 drafts: ${weekDay(shift, 1)} to ${weekDay(shift, 3)}` },
  { id: "i2", foundBy: "Your newsletter", title: "This Week in AI 40: Claude Duet, Kimi K3.1 Pro, DeepSeek 1017", why: "Posted three times; Claude Duet not posted yet", link: "thisweekinai.example/40", slot: `a draft: ${weekDay(shift, 3)}, LinkedIn, 15:00` },
  { id: "i3", foundBy: "Your YouTube", title: "Video: what NVIDIA's new Vera numbers mean for agents", why: "New video, no open time left this week", link: "youtube.example/thisweekinai" },
];

/** Example mode shows what is new in the example feeds; live mode says what works today: the AI reads the user's feeds through the connector. */
export function BriefingView({ mode = "example", ideasPreview, shift = 0 }: { mode?: "example" | "live"; ideasPreview?: IdeaBoard[]; /** Days the example week has moved on (demoShiftDays, read on the server). */ shift?: number }) {
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
        <BufferIdeasBoard preview={ideasPreview} />
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
        {ideas(shift).map((idea) => (
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
