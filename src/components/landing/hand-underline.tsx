"use client";

import { useEffect, useRef, type ReactNode } from "react";
import styles from "./hand-underline.module.css";

/**
 * A hand-drawn underline under a run of text, drawn once when the page opens.
 *
 * Each line box the text wraps onto gets two pen strokes, out and back, so a phrase that wraps keeps an underline on
 * every line. Every page load picks a new seed, so each visit draws a different line; a resize reuses the seed and
 * redraws the same line without animating. Reduced motion draws the underline already finished.
 */

/** Small seeded random (mulberry32), so a redraw on resize keeps the same pen shape. */
function seeded(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * One pen stroke from x1 to x2 at height y, the way a rough sketch line is drawn: the bow's size AND direction are
 * random, the two curve handles sit at a random split along the line, and every point is nudged. Long lines wobble
 * less, as a steady hand would. `offset` is the largest nudge in pixels.
 */
function stroke(x1: number, x2: number, y: number, offset: number, rnd: () => number) {
  const roughness = 1.5;
  const len = Math.abs(x2 - x1);
  const gain = len < 200 ? 1 : len > 500 ? 0.4 : -0.0016668 * len + 1.233334;
  // A random value between -x and x, scaled by how rough and how long the line is.
  const jitter = (x: number) => roughness * gain * (rnd() * 2 * x - x);
  const bow = jitter((offset * (x1 - x2)) / 200);
  const split = 0.2 + 0.2 * rnd();
  const n = () => jitter(offset);
  const f = (v: number) => v.toFixed(2);
  return `M${f(x1 + n())} ${f(y + n())} C${f(x1 + (x2 - x1) * split + n())} ${f(y + bow + n())}, ${f(x1 + 2 * (x2 - x1) * split + n())} ${f(y + bow + n())}, ${f(x2 + n())} ${f(y + n())}`;
}

export function HandUnderline({ children, duration = 800 }: { children: ReactNode; duration?: number }) {
  const text = useRef<HTMLSpanElement>(null);
  const svg = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const el = text.current, pad = svg.current;
    if (!el || !pad) return;
    const seed = Math.floor(Math.random() * 2 ** 31);
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let drawn = false;

    const draw = (animate: boolean) => {
      const origin = pad.getBoundingClientRect();
      const size = parseFloat(getComputedStyle(el).fontSize);
      const width = Math.max(2, size * 0.055);
      const rnd = seeded(seed);
      const rects = [...el.getClientRects()].filter((r) => r.width > 1);
      const total = rects.reduce((sum, r) => sum + r.width, 0);
      pad.replaceChildren();
      let delay = 0;
      for (const r of rects) {
        const x1 = r.left - origin.left, x2 = r.right - origin.left;
        const y = r.bottom - origin.top + size * 0.02;
        // Two strokes per line, out and back, as a pen would draw it.
        const share = (duration * r.width) / total / 2;
        // The sketch rules assume ~20px text with a 2px nudge; scale it up for display type so the hand still shows.
        const nudge = 2 * Math.min(2.5, Math.max(1, size / 24));
        for (const d of [stroke(x1, x2, y, nudge, rnd), stroke(x2, x1, y, nudge, rnd)]) {
          const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
          path.setAttribute("d", d);
          path.setAttribute("stroke-width", width.toFixed(2));
          pad.appendChild(path);
          if (animate) {
            const len = path.getTotalLength();
            path.style.strokeDasharray = `${len}`;
            path.style.strokeDashoffset = `${len}`;
            path.style.animation = `${styles.draw} ${share}ms ease-out ${delay}ms forwards`;
            delay += share;
          }
        }
      }
    };

    // Wait for the web font, so the first underline matches the final line breaks.
    void document.fonts.ready.then(() => { draw(!reduce); drawn = true; });
    const ro = new ResizeObserver(() => { if (drawn) draw(false); });
    ro.observe(el);
    return () => ro.disconnect();
  }, [duration]);

  return (
    <>
      <span ref={text}>{children}</span>
      <svg ref={svg} className={styles.pad} aria-hidden="true" />
    </>
  );
}
