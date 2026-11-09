"use client";

import { useEffect, useRef, useState } from "react";
import { Badge } from "@/registry/components/badge/badge";
import styles from "./pilot-week.module.css";
import { PilotGear, PilotHalo } from "./pilot-mark";

/**
 * The landing hero's picture: the Pilot, a crimson queue slot with eyes, standing above an example Buffer week.
 *
 * Its eyes follow the pointer on a damped spring and the far eye narrows as the head turns. It blinks, and while the
 * visitor is still it fills an empty slot with a draft. When a button carrying `data-pilot-say` is hovered, it looks at
 * that button and says the button's line. It has no click behaviour. Reduced motion keeps it still and silent.
 */

type SlotState = "scheduled" | "empty" | "draft";
interface Slot { time: string; channel: string; state: SlotState }

// Alex's demo week: the same accounts and the same filled, draft and empty times as the demo's Next week.
const DAYS: { day: string; slots: Slot[] }[] = [
  { day: "Mon", slots: [{ time: "9:00", channel: "X", state: "scheduled" }, { time: "12:00", channel: "LinkedIn", state: "scheduled" }] },
  { day: "Tue", slots: [{ time: "12:00", channel: "LinkedIn", state: "draft" }, { time: "18:00", channel: "Instagram", state: "empty" }] },
  { day: "Wed", slots: [{ time: "9:00", channel: "Threads", state: "empty" }, { time: "12:00", channel: "LinkedIn", state: "scheduled" }] },
  { day: "Thu", slots: [{ time: "9:00", channel: "X", state: "empty" }, { time: "15:00", channel: "LinkedIn", state: "empty" }] },
  { day: "Fri", slots: [{ time: "10:00", channel: "Instagram", state: "scheduled" }, { time: "12:00", channel: "LinkedIn", state: "empty" }] },
];

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** `week={false}` draws the Pilot alone, without the example week, for a hero that shows the real app below it. */
export function PilotWeek({ week = true, className, tone }: { week?: boolean; className?: string; tone?: "light" } = {}) {
  const [states, setStates] = useState<SlotState[]>(() => DAYS.flatMap((d) => d.slots.map((s) => s.state)));
  const [line, setLine] = useState("");
  // The full line, set once, for screen readers; the typed bubble is hidden from them.
  const [announce, setAnnounce] = useState("");
  const [talking, setTalking] = useState(false);
  const [fresh, setFresh] = useState<number | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const pilot = useRef<HTMLDivElement>(null);
  const body = useRef<SVGGElement>(null);
  const eyeL = useRef<SVGRectElement>(null);
  const eyeR = useRef<SVGRectElement>(null);
  const slotRefs = useRef<(HTMLDivElement | null)[]>([]);
  const look = useRef<Element | null>(null);
  const hop = useRef(0);
  const talkId = useRef(0);
  const statesRef = useRef(states);
  statesRef.current = states;

  const speak = async (text: string) => {
    const id = ++talkId.current;
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    setTalking(true);
    setAnnounce(text);
    hop.current = 1;
    if (reduce) setLine(text);
    else for (let i = 1; i <= text.length; i++) {
      await new Promise((r) => setTimeout(r, 22 + Math.random() * 20));
      if (id !== talkId.current) return;
      setLine(text.slice(0, i));
    }
    await new Promise((r) => setTimeout(r, 1800));
    if (id === talkId.current) setTalking(false);
  };

  useEffect(() => {
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const s = { x: 0, y: 0, vx: 0, vy: 0, tx: 0, ty: 0 };
    let lastMove = performance.now(), blinkAt = performance.now() + 1600, blinkStart = -1, raf = 0, busy = false;

    const aimAt = (px: number, py: number) => {
      const r = pilot.current?.getBoundingClientRect();
      if (!r) return;
      const dx = px - (r.left + r.width / 2), dy = py - (r.top + r.height * 0.45);
      const d = Math.hypot(dx, dy) || 1, k = Math.min(1, d / Math.max(r.width * 2.4, 280));
      s.tx = clamp((dx / d) * k, -1, 1); s.ty = clamp((dy / d) * k, -1, 1);
    };
    const onMove = (e: PointerEvent) => { lastMove = performance.now(); if (!look.current) aimAt(e.clientX, e.clientY); };
    addEventListener("pointermove", onMove, { passive: true });

    // A button with a line: look at it and say the line.
    // A Pilot inside a [data-pilot-scope] section answers only that section's buttons; the hero Pilot answers the rest.
    const own = root.current?.closest("[data-pilot-scope]");
    const targets = own ? [...own.querySelectorAll("[data-pilot-say]")] : [...document.querySelectorAll("[data-pilot-say]")].filter((t) => !t.closest("[data-pilot-scope]"));
    const enter = (e: Event) => { const el = e.currentTarget as HTMLElement; look.current = el; void speak(el.dataset.pilotSay ?? ""); };
    const leave = () => { look.current = null; };
    // Keyboard focus counts as pointing, so the lines are not mouse-only.
    targets.forEach((t) => { t.addEventListener("pointerenter", enter); t.addEventListener("pointerleave", leave); t.addEventListener("focus", enter); t.addEventListener("blur", leave); });

    // A still visitor: look at an empty slot, fill it with a draft, look back. A full week starts over.
    const idle = reduce ? 0 : window.setInterval(() => {
      if (!week || document.hidden || busy || look.current || performance.now() - lastMove < 2400) return;
      // Only slots on screen: phones hide Thu and Fri, and the Pilot must not stare at a hidden one.
      const empty = statesRef.current.flatMap((st, i) => (st === "empty" && slotRefs.current[i]?.offsetParent ? [i] : []));
      if (!empty.length) { setStates(DAYS.flatMap((d) => d.slots.map((x) => x.state))); return; }
      const i = empty[Math.floor(Math.random() * empty.length)];
      busy = true; look.current = slotRefs.current[i];
      window.setTimeout(() => {
        setStates((prev) => prev.map((st, k) => (k === i ? "draft" : st)));
        setFresh(i); hop.current = 0.7;
        window.setTimeout(() => { look.current = null; busy = false; }, 900);
      }, 650);
    }, 2600);

    const frame = (t: number) => {
      if (look.current) { const r = look.current.getBoundingClientRect(); aimAt(r.left + r.width / 2, r.top + r.height / 2); }
      if (reduce) { s.x = s.tx * 0.4; s.y = s.ty * 0.4; }
      else { s.vx += (s.tx - s.x) * 0.075; s.vy += (s.ty - s.y) * 0.075; s.vx *= 0.8; s.vy *= 0.8; s.x += s.vx; s.y += s.vy; }
      if (t > blinkAt) { blinkStart = t; blinkAt = t + 2400 + Math.random() * 3600; }
      const bt = t - blinkStart;
      const lid = !reduce && bt >= 0 && bt < 140 ? 1 - 0.9 * Math.sin((bt / 140) * Math.PI) : 1;
      hop.current *= 0.9;
      const up = Math.sin(Math.min(1, hop.current) * Math.PI), lift = -up * 7, squash = 1 + up * 0.04;
      ([[eyeL.current, -1], [eyeR.current, 1]] as const).forEach(([el, side]) => {
        if (!el) return;
        const turn = clamp(1 - Math.max(0, -side * s.x) * 0.45, 0.45, 1);
        // The eyes look around inside the face only: never up into the cap or the goggles, or out under the ear flaps.
        const w = 9 * turn, h = 17 * lid, cx = side * 15 + clamp(s.x, -0.65, 0.65) * 16, cy = -4 + Math.max(-0.6, s.y) * 12;
        el.setAttribute("x", (cx - w / 2).toFixed(2)); el.setAttribute("y", (cy - h / 2).toFixed(2));
        el.setAttribute("width", w.toFixed(2)); el.setAttribute("height", Math.max(1.4, h).toFixed(2));
        el.setAttribute("rx", Math.min(4.5, w / 2, h / 2).toFixed(2));
      });
      // The body only shifts and hops; it never tilts, so it always stands straight on the week.
      body.current?.setAttribute("transform", `translate(${(s.x * 3).toFixed(2)} ${lift.toFixed(2)}) scale(${(2 - squash).toFixed(3)} ${squash.toFixed(3)})`);
      raf = requestAnimationFrame(frame);
    };
    const io = new IntersectionObserver(([e]) => { cancelAnimationFrame(raf); if (e.isIntersecting) raf = requestAnimationFrame(frame); });
    if (root.current) io.observe(root.current);

    return () => {
      removeEventListener("pointermove", onMove);
      targets.forEach((t) => { t.removeEventListener("pointerenter", enter); t.removeEventListener("pointerleave", leave); t.removeEventListener("focus", enter); t.removeEventListener("blur", leave); });
      window.clearInterval(idle); cancelAnimationFrame(raf); io.disconnect();
    };
    // speak only reads refs and setters, so the effect runs once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  let index = 0;
  return (
    <div className={[styles.root, className].filter(Boolean).join(" ")} ref={root} data-tone={tone}>
      <div ref={pilot} className={styles.pilot}>
        <span className={styles.say} data-show={talking || undefined} aria-hidden="true">{line}</span>
        <span className={styles.sr} role="status">{announce}</span>
        <svg viewBox="-60 -60 120 120" role="img" aria-label="Queue Pilot">
          <defs><clipPath id="pilot-shell"><rect x="-46" y="-48" width="92" height="94" rx="26" /></clipPath></defs>
          <g ref={body}>
            <rect className={styles.ring} x="-50" y="-52" width="100" height="102" rx="30" />
            <PilotHalo />
            <g clipPath="url(#pilot-shell)">
              <rect className={styles.shell} x="-46" y="-48" width="92" height="94" />
              <rect className={styles.belly} x="-46" y="30" width="92" height="16" />
            </g>
            <PilotGear shell="pilot-shell" glint={styles.glint} />
            <rect ref={eyeL} className={styles.eye} x="-19.5" y="-12.5" width="9" height="17" rx="4.5" />
            <rect ref={eyeR} className={styles.eye} x="10.5" y="-12.5" width="9" height="17" rx="4.5" />
          </g>
        </svg>
      </div>

      {week ? <div className={styles.week} aria-label="Example Buffer week">
        <div className={styles.head}><b>Next week</b><span>Alex Rivera, demo</span></div>
        <div className={styles.days}>
          {DAYS.map((d) => (
            <div key={d.day} className={styles.day}>
              <b>{d.day}</b>
              {d.slots.map((slot) => {
                const i = index++;
                return (
                  <div key={i} ref={(el) => { slotRefs.current[i] = el; }} className={styles.slot} data-state={states[i]} data-fresh={fresh === i || undefined}>
                    <span className={styles.time}>{slot.time}</span>
                    <span className={styles.channel}>{slot.channel}</span>
                    {states[i] === "draft" ? <Badge size="sm" className={styles.badge}>Draft</Badge> : null}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div> : null}
    </div>
  );
}
