"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import styles from "./pointer-tour.module.css";

/** One stop of the tour: how to find the part on the real draft window, and what to say about it. */
export type TourStop = { find: (root: HTMLElement) => HTMLElement | undefined; title: string; text: string; side?: Side };
type Side = "right" | "left" | "above" | "below";
/** Where the popover opens: beside its target, never over it. */
type Place = { side: Side; x: number; y: number; w: number };

const POP_WIDE = 248, POP_H = 76, GAP = 12, PAD = 6;
/** Picks the first side with room inside the frame: the stop's own preference, then right, left, below, above. */
function placeBeside(r: DOMRect, box: DOMRect, prefer?: Side): Place {
  // On a phone the card is narrow: the popover takes the card's width less a margin, and opens above or below.
  const POP_W = Math.min(POP_WIDE, box.width - 16);
  const x0 = r.left - box.left, x1 = r.right - box.left, y0 = r.top - box.top, y1 = r.bottom - box.top;
  const cy = (y0 + y1) / 2, clampX = (x: number) => Math.max(8, Math.min(box.width - POP_W - 8, x));
  const fits: Record<Side, boolean> = {
    right: x1 + GAP + POP_W <= box.width - 8, left: x0 - GAP - POP_W >= 8,
    below: y1 + GAP + POP_H <= box.height - 4, above: y0 - GAP - POP_H >= 4,
  };
  const order: Side[] = [...(prefer ? [prefer] : []), "right", "left", "below", "above"];
  const side = order.find((o) => fits[o]) ?? "below";
  if (side === "right") return { side, x: x1 + GAP, y: cy, w: POP_W };
  if (side === "left") return { side, x: x0 - GAP - POP_W, y: cy, w: POP_W };
  return { side, x: clampX(x0), y: side === "below" ? y1 + GAP : y0 - GAP, w: POP_W };
}

/** Finds the innermost element whose own text matches, so the pointer lands on the label, not its whole section. */
export const byText = (root: HTMLElement, test: (s: string) => boolean) =>
  [...root.querySelectorAll<HTMLElement>("h2, h3, h4, p, span, b, strong, button, dt, th, td, div")]
    .filter((el) => test((el.textContent ?? "").trim()))
    .sort((a, b) => (a.textContent ?? "").length - (b.textContent ?? "").length)[0];


/** Our pointer in pixels, the same one the walkthrough uses: "o" is the white edge, "x" the crimson fill. */
const POINTER_ROWS = [
  "o", "oo", "oxo", "oxxo", "oxxxo", "oxxxxo", "oxxxxxo", "oxxxxxxo", "oxxxxxxxo", "oxxxxxxxxo",
  "oxxxxxoooo", "oxxoxxo", "oxo.oxxo", "oo..oxxo", "o....oxxo", ".....oxxo", "......oo",
];
const POINTER = POINTER_ROWS.flatMap((row, y) => [...row].map((c, x) =>
  c === "." ? null : <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} className={c === "x" ? styles.fill : styles.edge} />));
const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

/**
 * A real screen from the app with Alex's demo data, toured by our pointer: it rests on each stop in turn and a small
 * pixel-cornered popover says what that part is. Visitors cannot click into the screen. It plays only while on screen and never pauses on hover; moving the mouse near a part
 * sends the pointer there, and the tour carries on in order from that part.
 */
export function PointerTour({ stops: STOPS, children, className }: { stops: TourStop[]; children: ReactNode; className?: string }) {
  const root = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const [say, setSay] = useState<{ i: number; place: Place } | null>(null);
  // The spotlight: the part being explained stays bright, the rest of the screen fades back behind a soft wash.
  const [spot, setSpot] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    let alive = true, visible = false, pos = { x: el.clientWidth * 0.7, y: el.clientHeight * 0.8 };
    // A visitor's mouse over the window picks the part nearest it: the tour goes there next and carries on in order.
    let jump: number | null = null, current = -1;
    const wait = async (ms: number) => { let left = ms; while (left > 0 && alive && jump === null) { await new Promise((r) => setTimeout(r, 50)); if (visible) left -= 50; } };
    const glide = (to: { x: number; y: number }) => new Promise<void>((done) => {
      const from = pos, dist = Math.hypot(to.x - from.x, to.y - from.y), length = Math.min(900, 350 + dist * 0.6);
      let start = 0;
      const step = (now: number) => {
        if (!alive) return done();
        start ||= now;
        const k = Math.min(1, (now - start) / length), e = ease(k);
        pos = { x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e - Math.sin(k * Math.PI) * Math.min(30, dist * 0.08) };
        setAt(pos);
        if (k < 1) requestAnimationFrame(step); else done();
      };
      requestAnimationFrame(step);
    });
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const play = async () => {
      let i = 0;
      while (alive) {
        if (jump !== null) { i = jump; jump = null; }
        current = i;
        const target = STOPS[i].find(el);
        if (target) {
          const box = el.getBoundingClientRect(), r = target.getBoundingClientRect();
          const to = { x: r.left - box.left + Math.min(r.width * 0.5, 40), y: r.top - box.top + r.height * 0.6 };
          setSay(null);
          setSpot({ x: r.left - box.left - PAD, y: r.top - box.top - PAD, w: r.width + PAD * 2, h: r.height + PAD * 2 });
          if (still) { pos = to; setAt(to); } else await glide(to);
          const lit = new DOMRect(r.left - PAD, r.top - PAD, r.width + PAD * 2, r.height + PAD * 2);
          setSay({ i, place: placeBeside(lit, box, STOPS[i].side) });
          // Long enough to read the popover at an average 4 words a second, plus a moment to look.
          await wait(Math.max(3500, `${STOPS[i].title} ${STOPS[i].text}`.split(/\s+/).length * 250 + 1500));
        }
        i = (i + 1) % STOPS.length;
      }
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      const near = STOPS.map((s, k) => {
        const r = s.find(el)?.getBoundingClientRect();
        if (!r) return { k, d: Infinity };
        const dx = Math.max(r.left - e.clientX, 0, e.clientX - r.right), dy = Math.max(r.top - e.clientY, 0, e.clientY - r.bottom);
        return { k, d: Math.hypot(dx, dy) };
      }).sort((a, b) => a.d - b.d)[0];
      if (near && near.d < 160 && near.k !== current && jump === null) jump = near.k;
    };
    el.addEventListener("pointermove", onMove);
    const seen = new IntersectionObserver(([e]) => { visible = e.isIntersecting; }, { threshold: 0.3 });
    seen.observe(el);
    void play();
    return () => { alive = false; seen.disconnect(); el.removeEventListener("pointermove", onMove); };
  }, [STOPS]);

  const stop = say ? STOPS[say.i] : null;
  return (
    <div ref={root} className={[styles.root, className].filter(Boolean).join(" ")}>
      <div className={styles.screen} inert>{children}</div>
      {spot && <div className={styles.spot} style={{ transform: `translate(${spot.x}px, ${spot.y}px)`, width: spot.w, height: spot.h }} aria-hidden="true" />}
      {at && (
        <div className={styles.pointer} style={{ transform: `translate(${at.x}px, ${at.y}px)` }} aria-hidden="true">
          <svg viewBox="0 0 11 17" shapeRendering="crispEdges">{POINTER}</svg>
        </div>
      )}
      {stop && say && (
        <div key={say.i} className={styles.pop} data-side={say.place.side} style={{ left: say.place.x, top: say.place.y, width: say.place.w }} aria-hidden="true">
          <b>{stop.title}</b>
          <span>{stop.text}</span>
        </div>
      )}
    </div>
  );
}
