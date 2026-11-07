"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { WeekModel } from "@/lib/week-model";
import { BOARD, HERO_LOOP, HERO_SIZE, STEP_AT, drawHero, drawQuote, layoutWeek } from "./pixel-hero-scene";
import styles from "./pixel-hero.module.css";


const STEPS = [
  { title: "Your empty times", text: "Queue Pilot reads your Buffer week and finds the times with no post." },
  { title: "Drafts from what you published", text: "Your AI writes a post for each empty time from your newsletter, blog or videos." },
  { title: "Every draft is checked", text: "Against your rules, the quotes in your source, and what Buffer accepts." },
  { title: "Problems are caught first", text: "A post that would fail, here a disconnected Threads channel, is held back with the reason." },
  { title: "You approve, Buffer schedules", text: "Approve one draft or every ready one at once. Approve is what schedules them." },
] as const;

/**
 * How long each step stays up, in real seconds: time to read its line at an average 240 words a minute (4 a second),
 * plus two seconds to look at the picture. The scene's own timing (STEP_AT) is stretched to fit, step by step.
 */
const READ = STEPS.map((s) => Math.max(4.5, `${s.title} ${s.text}`.split(/\s+/).length / 4 + 2));
const REAL_AT = READ.map((_, i) => READ.slice(0, i).reduce((a, b) => a + b, 0));
const REAL_LOOP = READ.reduce((a, b) => a + b, 0);
const SCENE_END = [...STEP_AT.slice(1), HERO_LOOP];
/** Real time into the loop, to the step showing and the scene time to draw. */
const sceneAt = (real: number) => {
  const r = real % REAL_LOOP;
  const i = REAL_AT.reduce<number>((s, start, k) => (r >= start ? k : s), 0);
  return { step: i, t: STEP_AT[i] + ((r - REAL_AT[i]) / READ[i]) * (SCENE_END[i] - STEP_AT[i]) };
};

/**
 * The homepage hero as pixel art (pixel-hero-scene.ts): Alex's demo week, drawn at 192x96 and scaled up crisp, playing
 * the five steps on a loop with the step's title and sentence underneath. Twelve frames a second, only while on screen;
 * reduced motion shows the finished week. It never pauses on hover: it runs whenever it is on screen.
 */
export function PixelHero({ week }: { week: WeekModel }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const top = useRef<HTMLCanvasElement>(null);
  const [blur, setBlur] = useState(false);
  const cards = useMemo(() => layoutWeek(week), [week]);
  const [step, setStep] = useState(0);
  useEffect(() => {
    const g = ref.current?.getContext("2d"), q = top.current?.getContext("2d");
    if (!ref.current || !g || !q) return;
    // The board and the quote panel are separate layers, so the board can blur behind the panel like a page behind a modal.
    const draw = (at: number) => { drawHero(g, cards, at); setBlur(drawQuote(q, cards, at)); };
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) { draw(HERO_LOOP - 2); setStep(4); return; }
    let t = 0, last = performance.now(), frame = 0, inView = false, tick = 0;
    const loop = (now: number) => {
      t += (now - last) / 1000;
      last = now;
      if (now - tick > 83) {
        tick = now;
        const at = sceneAt(t);
        draw(at.t);
        setStep(at.step);
      }
      if (inView) frame = requestAnimationFrame(loop);
    };
    draw(0);
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
      <div className={styles.layers} data-blur={blur || undefined}>
        <canvas ref={ref} width={HERO_SIZE.width} height={HERO_SIZE.height} className={styles.canvas} aria-hidden="true" />
        {/* Marks exactly where the board is, so the page's dots come right up to its edge. */}
        <div className={styles.frame} data-field-frame="" data-field-cells={BOARD.w} style={{ left: `${(BOARD.x / HERO_SIZE.width) * 100}%`, top: `${(BOARD.y / HERO_SIZE.height) * 100}%`, width: `${(BOARD.w / HERO_SIZE.width) * 100}%`, height: `${(BOARD.h / HERO_SIZE.height) * 100}%` }} />
        <canvas ref={top} width={HERO_SIZE.width} height={HERO_SIZE.height} className={styles.top} aria-hidden="true" />
      </div>
      <figcaption className={styles.caption} data-field-clear="">
        <span className={styles.n}>{step + 1}/{STEPS.length}</span>
        <p key={step} className={styles.line}><b>{STEPS[step].title}.</b> {STEPS[step].text}</p>
      </figcaption>
    </figure>
  );
}
