"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addSource } from "@/app/(app)/actions";
import { Alert } from "@/registry/components/alert/alert";
import { Button } from "@/registry/components/button/button";
import type { WritingAvailability } from "@/lib/writing-availability";
import { WriteWeekButton } from "./write-week-button";
import styles from "./home-start.module.css";

/**
 * The first-drafts panel on Home, shown until Queue Pilot has written a draft for the week: add one feed, then fill
 * next week's empty times with the built-in writer. Connecting the person's own AI is offered beside it, never
 * required first.
 */
export function HomeStart({ hasSource, writing, count }: { hasSource: boolean; writing: WritingAvailability; count: number }) {
  const [url, setUrl] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [read, setRead] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  const add = () => start(async () => {
    setProblem(null);
    const res = await addSource(url);
    if (!res.ok) return setProblem(res.message);
    // Said back to the person, so they can see their feed was really read before anything is written from it.
    const newest = res.read?.newest ? new Date(res.read.newest).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : null;
    setRead(`Read "${res.title}": ${res.read?.items ?? 0} item${res.read?.items === 1 ? "" : "s"}${newest ? `, newest from ${newest}` : ""}.`);
    setUrl("");
    router.refresh();
  });

  return (
    <section className={styles.start} aria-labelledby="start-title">
      <h2 id="start-title" className={styles.title}>Fill next week from what you publish</h2>
      {read && <p className={styles.read} role="status">{read}</p>}
      {hasSource ? (
        <WriteWeekButton availability={writing} count={count} />
      ) : (
        <>
          <p className={styles.muted}>Paste the address of your newsletter, blog, YouTube channel or GitHub releases. Queue Pilot reads what you published, writes one draft for each empty time from it, and saves them in Buffer as drafts.</p>
          <form className={styles.row} onSubmit={(e) => { e.preventDefault(); if (url.trim()) add(); }}>
            <label htmlFor="start-feed" className="sr-only">Address of your newsletter, blog or channel</label>
            <input id="start-feed" className={styles.input} type="text" inputMode="url" autoComplete="url" placeholder="yourname.substack.com" value={url} onChange={(e) => setUrl(e.target.value)} />
            <Button type="submit" variant="primary" disabled={pending || !url.trim()}>{pending ? "Reading…" : "Add"}</Button>
          </form>
          {problem && <Alert tone="danger" title="Not added">{problem}</Alert>}
        </>
      )}
      <p className={styles.muted}>Or have the AI you already use write them: <Link href="/connect">connect your AI</Link>.</p>
    </section>
  );
}
