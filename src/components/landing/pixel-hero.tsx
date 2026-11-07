"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { WeekModel } from "@/lib/week-model";
import { HERO_LOOP, HERO_SIZE, STEP_AT, drawHero, layoutWeek } from "./pixel-hero-scene";
import styles from "./pixel-hero.module.css";

/** Real time: the scene is timed so every step gets about the same few seconds. */
const SPEED = 1;

const STEPS = [
  { title: "Your empty times", text: "Queue Pilot reads your Buffer week and finds the times with no post." },
  { title: "Drafts from your newsletter", text: "Your AI writes a post for each empty time from your latest issue." },
  { title: "Every draft is checked", text: "Against your rules, the quotes in your source, and what Buffer accepts." },
  { title: "Problems are caught first", text: "A post that would fail, here a disconnected Threads channel, is held back with the reason." },
  { title: "You approve, Buffer schedules", text: "Approve one draft or every ready one at once. Approve is what schedules them." },
] as const;

/**
 * The homepage hero as pixel art (pixel-hero-scene.ts): Alex's demo week, drawn at 192x96 and scaled up crisp, playing
 * the five steps on a loop with the step's title and sentence underneath. Twelve frames a second, only while on screen;
 * reduced motion shows the finished week. It never pauses on hover: it runs whenever it is on screen.
 */
export function PixelHero({ week }: { week: WeekModel }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const cards = useMemo(() => layoutWeek(week), [week]);
  const [step, setStep] = useState(0);
  useEffect(() => {
    const g = ref.current?.getContext("2d");
    if (!ref.current || !g) return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) { drawHero(g, cards, HERO_LOOP - 2); setStep(4); return; }
    let t = 0, last = performance.now(), frame = 0, inView = false, tick = 0;
    const loop = (now: number) => {
      t += ((now - last) / 1000) * SPEED;
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
    <figure className={styles.hero}>
      <canvas ref={ref} width={HERO_SIZE.width} height={HERO_SIZE.height} className={styles.canvas} aria-hidden="true" />
      <figcaption className={styles.caption}>
        <span className={styles.n}>{step + 1}/{STEPS.length}</span>
        <p key={step} className={styles.line}><b>{STEPS[step].title}.</b> {STEPS[step].text}</p>
      </figcaption>
    </figure>
  );
}
