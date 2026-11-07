"use client";

import { useEffect, useRef, useState, type ComponentProps } from "react";
import { WeekView } from "@/components/week-view";
import { ToastStackProvider } from "@/registry/components/toast-stack/toast-stack";
import styles from "./draft-tour.module.css";

/** One stop of the tour: how to find the part on the real draft window, and what to say about it. */
type Stop = { find: (root: HTMLElement) => HTMLElement | undefined; title: string; text: string };

/** Finds the innermost element whose own text matches, so the pointer lands on the label, not its whole section. */
const byText = (root: HTMLElement, test: (s: string) => boolean) =>
  [...root.querySelectorAll<HTMLElement>("h2, h3, h4, p, span, b, strong, button, dt, th, td, div")]
    .filter((el) => test((el.textContent ?? "").trim()))
    .sort((a, b) => (a.textContent ?? "").length - (b.textContent ?? "").length)[0];

const STOPS: Stop[] = [
  { find: (r) => byText(r, (s) => s === "Post"), title: "A draft in your Buffer week",
    text: "Your AI wrote it for an empty LinkedIn time. It waits in Buffer as a draft." },
  { find: (r) => byText(r, (s) => s.startsWith("In this draft")), title: "Quotes match the source",
    text: "Each quote is matched word for word to the page it came from." },
  { find: (r) => byText(r, (s) => s === "Checks"), title: "Checked before Buffer",
    text: "Your playbook rules, and whether this channel can take the post right now." },
  { find: (r) => byText(r, (s) => s.startsWith("Notes")), title: "Notes from your team",
    text: "Teammates leave notes on the draft. Type @ to mention someone." },
  { find: (r) => byText(r, (s) => s === "Edit"), title: "Change it, then approve",
    text: "Edit here or in Buffer. Approving is what schedules it." },
];

/** Our pointer in pixels, the same one the walkthrough uses: "o" is the white edge, "x" the crimson fill. */
const POINTER_ROWS = [
  "o", "oo", "oxo", "oxxo", "oxxxo", "oxxxxo", "oxxxxxo", "oxxxxxxo", "oxxxxxxxo", "oxxxxxxxxo",
  "oxxxxxoooo", "oxxoxxo", "oxo.oxxo", "oo..oxxo", "o....oxxo", ".....oxxo", "......oo",
];
const POINTER = POINTER_ROWS.flatMap((row, y) => [...row].map((c, x) =>
  c === "." ? null : <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} className={c === "x" ? styles.fill : styles.edge} />));
const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

/**
 * A real draft window from the app with Alex's demo data, toured by our pointer: it rests on five parts in turn and a
 * small popover says what each one is. The window's close button is hidden, since there is nothing to close here, and
 * visitors cannot click into it. It plays only while on screen and never pauses on hover; moving the mouse near a part
 * sends the pointer there, and the tour carries on in order from that part.
 */
export function DraftTour(props: ComponentProps<typeof WeekView>) {
  const root = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const [say, setSay] = useState<{ i: number; side: "left" | "right" } | null>(null);
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
          if (still) { pos = to; setAt(to); } else await glide(to);
          setSay({ i, side: to.x > el.clientWidth * 0.55 ? "left" : "right" });
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
  }, []);

  const stop = say ? STOPS[say.i] : null;
  return (
    <div ref={root} className={styles.root}>
      <div className={styles.screen} inert>
        <ToastStackProvider><WeekView {...props} /></ToastStackProvider>
      </div>
      {at && (
        <div className={styles.pointer} style={{ transform: `translate(${at.x}px, ${at.y}px)` }} aria-hidden="true">
          <svg viewBox="0 0 11 17" shapeRendering="crispEdges">{POINTER}</svg>
          {stop && (
            <div key={say?.i} className={styles.pop} data-side={say?.side}>
              <b>{stop.title}</b>
              <span>{stop.text}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
