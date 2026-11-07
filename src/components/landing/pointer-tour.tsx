"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import styles from "./pointer-tour.module.css";

/** One stop of the tour: how to find the part on the real draft window, and what to say about it. */
export type TourStop = { find: (root: HTMLElement) => HTMLElement | undefined; title: string; text: string; side?: Side };
type Side = "right" | "left" | "above" | "below";
/** Where the popover opens: beside its target, never over it. */
type Place = { side: Side; x: number; y: number; w: number };

const POP_WIDE = 248, POP_H = 76, GAP = 12, PAD = 6;
/**
 * Where the pointer rests: just after the last word of the part it explains, so the words themselves stay readable.
 * Kept inside the frame (the pointer is 30 by 46).
 */
function tipAfter(el: HTMLElement, box: DOMRect) {
  const range = document.createRange();
  range.selectNodeContents(el);
  const lines = [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0);
  const end = lines[lines.length - 1] ?? el.getBoundingClientRect();
  return { x: Math.min(end.right - box.left + 6, box.width - 34), y: Math.min(end.top - box.top + end.height * 0.3, box.height - 50) };
}

/**
 * Puts the popover just below the highlighted part, never on it, so the eye reads the part first and the note
 * second; above it when below would run out of the frame. It lines up with the pointer, kept inside the frame.
 */
function placeBeside(tip: { x: number; y: number }, part: DOMRect, box: DOMRect): Place {
  const POP_W = Math.min(POP_WIDE, box.width - 16);
  const x = Math.max(8, Math.min(tip.x - 24, box.width - POP_W - 8));
  const below = Math.max(part.bottom - box.top + PAD + 8, tip.y + 46);
  if (below + POP_H <= box.height - 4) return { side: "below", x, y: below, w: POP_W };
  return { side: "above", x, y: part.top - box.top - PAD - 8, w: POP_W };
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
const cells = (want: string, className: string) => POINTER_ROWS.flatMap((row, y) => [...row].map((c, x) =>
  c === want ? <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} className={className} /> : null));
const EDGE = cells("o", styles.edge);

/**
 * The pointer is its own timer: its body starts pale and fills with crimson from the tip down over `ms`; when it is
 * full, the next stop comes. `run` restarts the fill.
 */
export function TimerPointer({ ms, run, className }: { ms: number | null; run: number; className?: string }) {
  const clip = useId().replace(/:/g, "");
  const fill = useRef<SVGAnimateElement>(null);
  // SVG animations count from the page's own start, so a fill added later would already be over: start it by hand.
  useEffect(() => { if (ms) fill.current?.beginElement(); }, [ms, run]);
  return (
    <svg viewBox="0 0 11 17" shapeRendering="crispEdges" className={className}>
      <clipPath id={clip}>
        <rect x="0" y="0" width="11" height={ms ? 0 : 17}>
          {ms ? <animate key={run} ref={fill} attributeName="height" from="0" to="17" dur={`${ms}ms`} begin="indefinite" fill="freeze" /> : null}
        </rect>
      </clipPath>
      {cells("x", styles.pale)}
      <g clipPath={`url(#${clip})`}>{cells("x", styles.fill)}</g>
      {EDGE}
    </svg>
  );
}
const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

/**
 * A real screen from the app with Alex's demo data, toured by our pointer: it rests on each stop in turn and a small
 * pixel-cornered popover says what that part is. Visitors cannot click into the screen. It plays only while on screen and never pauses on hover; moving the mouse near a part
 * sends the pointer there, and the tour carries on in order from that part.
 */
export function PointerTour({ stops: STOPS, children, className }: { stops: TourStop[]; children: ReactNode; className?: string }) {
  const root = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const [say, setSay] = useState<{ i: number; place: Place; ms: number } | null>(null);
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
          // Aim inside the part, and keep the whole pointer (30 by 46) inside the frame so its edge never cuts it off.
          const to = tipAfter(target, box);
          setSay(null);
          setSpot({ x: r.left - box.left - PAD, y: r.top - box.top - PAD, w: r.width + PAD * 2, h: r.height + PAD * 2 });
          if (still) { pos = to; setAt(to); } else await glide(to);
          // Long enough to read the popover at an average 4 words a second, plus a moment to look; the pointer fills to show it.
          const ms = Math.max(3500, `${STOPS[i].title} ${STOPS[i].text}`.split(/\s+/).length * 250 + 1500);
          setSay({ i, place: placeBeside(to, r, box), ms });
          await wait(ms);
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
          <TimerPointer ms={say?.ms ?? null} run={say?.i ?? -1} />
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
