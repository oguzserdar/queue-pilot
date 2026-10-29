"use client";

import { useState } from "react";
import { DAYS, channels, posts, type Post } from "@/lib/demo-data";
import { TONE_LABEL, worstTone } from "@/lib/week-model";
import styles from "./embed-week.module.css";

const mins = (t: string) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };

/** The compact week the Queue Pilot plugin shows inside ChatGPT or Claude. Same data and rules as the web app. */
export function EmbedWeek() {
  const drafts = posts.filter((p) => p.status === "draft").sort((a, b) => a.day - b.day || mins(a.time) - mins(b.time));
  const [approved, setApproved] = useState<Set<string>>(new Set());
  const ready = drafts.filter((p) => worstTone(p) !== "danger" && !approved.has(p.id));
  const chan = (id: Post["channel"]) => channels.find((c) => c.id === id)!.name;

  return (
    <section className={styles.widget} aria-labelledby="qp-embed-title">
      <header className={styles.head}>
        <div>
          <h1 id="qp-embed-title" className={styles.title}>Next week, 26 Oct to 1 Nov</h1>
          <p className={styles.sub}>5 drafts in your open slots, each checked against your Buffer channels.</p>
        </div>
        <button type="button" className={styles.all} disabled={ready.length === 0} onClick={() => setApproved((s) => new Set([...s, ...ready.map((p) => p.id)]))}>
          {ready.length ? `Approve ${ready.length}` : "All approved"}
        </button>
      </header>
      <ul className={styles.list}>
        {drafts.map((p) => {
          const t = worstTone(p);
          const on = approved.has(p.id);
          return (
            <li key={p.id} className={styles.item} data-tone={t} data-on={on}>
              <span className={styles.when}>{DAYS[p.day]}<br /><span className={styles.time}>{chan(p.channel)}, {p.time}</span></span>
              <span className={styles.text}>{p.text}<span className={styles.src}>From {p.source?.foundBy.replace(/^Your /, "your ")}</span></span>
              <span className={styles.state}><span className={styles.mark} aria-hidden="true" />{on ? "Approved" : TONE_LABEL[t]}</span>
              {t === "danger" ? (
                <a className={styles.one} href="https://buffer.com" target="_blank" rel="noreferrer">Fix in Buffer</a>
              ) : (
                <button type="button" className={styles.one} disabled={on} onClick={() => setApproved((s) => new Set(s).add(p.id))}>
                  {on ? "Done" : "Approve"}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      <footer className={styles.foot}>Example week. Queue Pilot is built on the Buffer API and is not made by Buffer.</footer>
    </section>
  );
}
