"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { WeekModel } from "@/lib/week-model";
import { HERO_LOOP, HERO_SIZE, STEP_AT, drawHero, layoutWeek } from "./pixel-hero-scene";
import styles from "./pixel-hero.module.css";

const STEPS = [
  { title: "Your empty times", text: "Queue Pilot reads your Buffer week and finds the times with no post." },
  { title: "Drafts from your newsletter", text: "Your AI writes a post for each empty time from your latest issue." },
  { title: "Every draft is checked", text: "Against your rules, the quotes in your source, and what Buffer accepts." },
  { title: "Problems are caught first", text: "A post that would fail, here a disconnected Threads channel, is held back with the reason." },
  { title: "You approve, Buffer schedules", text: "Approve one draft or every ready one at once. Approve is what schedules them." },
] as const;

/**
 * The homepage hero as pixel art (pixel-hero-scene.ts): Alex's demo week, drawn at 192x108 and scaled up crisp, playing
 * the five steps on a loop with the step's title and sentence underneath. Twelve frames a second, only while on screen;
 * reduced motion shows the finished week. Hover or tap pauses it.
 */
export function PixelHero({ week }: { week: WeekModel }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const cards = useMemo(() => layoutWeek(week), [week]);
  const [step, setStep] = useState(0);
  const paused = useRef(false);
  useEffect(() => {
    const g = ref.current?.getContext("2d");
    if (!ref.current || !g) return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) { drawHero(g, cards, HERO_LOOP - 2); setStep(4); return; }
    let t = 0, last = performance.now(), frame = 0, inView = false, tick = 0;
    const loop = (now: number) => {
      if (!paused.current) t += (now - last) / 1000;
      last = now;
      if (now - tick > 83) {
        tick = now;
        drawHero(g, cards, t);
        const at = t % HERO_LOOP;
        setStep(STEP_AT.reduce<number>((s, start, i) => (at >= start ? i : s), 0));
      }
      if (inView) frame = requestAnimationFrame(loop);
    };
    drawHero(g, cards, 0);
    const seen = new IntersectionObserver(([e]) => {
      inView = e.isIntersecting;
      cancelAnimationFrame(frame);
      if (inView) { last = performance.now(); frame = requestAnimationFrame(loop); }
    });
    seen.observe(ref.current);
    return () => { cancelAnimationFrame(frame); seen.disconnect(); };
  }, [cards]);
  return (
    <figure className={styles.hero} onPointerEnter={() => { paused.current = true; }} onPointerLeave={() => { paused.current = false; }}>
      <canvas ref={ref} width={HERO_SIZE.width} height={HERO_SIZE.height} className={styles.canvas} aria-hidden="true" />
      <figcaption className={styles.caption} aria-live="off">
        <ol className={styles.dots} aria-hidden="true">{STEPS.map((_, i) => <li key={i} data-on={i === step || undefined} data-done={i < step || undefined} />)}</ol>
        <p key={step} className={styles.line}><span className={styles.n}>{step + 1} of {STEPS.length}</span> <b>{STEPS[step].title}.</b> {STEPS[step].text}</p>
      </figcaption>
    </figure>
  );
}
