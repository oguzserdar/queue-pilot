"use client";

import { useEffect, useRef, useState, type ComponentProps } from "react";
import { ToastStackProvider } from "@/registry/components/toast-stack/toast-stack";
import { WeekView } from "@/components/week-view";
import { countOpenSlots } from "@/lib/week-model";
import styles from "./hero-walkthrough.module.css";

type WeekProps = ComponentProps<typeof WeekView>;
type Target = (root: HTMLElement) => HTMLElement | null | undefined;

const byText = (root: ParentNode, test: (s: string) => boolean) =>
  [...root.querySelectorAll<HTMLElement>("button")].find((b) => test((b.textContent ?? "").trim()));
const draftCard = (text: string): Target => (root) => byText(root, (s) => s.includes(text.slice(0, 24)));
/**
 * Our pointer, drawn in pixels like the setup scenes: "o" is the white edge, "x" the crimson fill. Each cell becomes
 * one square, so it scales up crisp.
 */
const POINTER_ROWS = [
  "o", "oo", "oxo", "oxxo", "oxxxo", "oxxxxo", "oxxxxxo", "oxxxxxxo", "oxxxxxxxo", "oxxxxxxxxo",
  "oxxxxxoooo", "oxxoxxo", "oxo.oxxo", "oo..oxxo", "o....oxxo", ".....oxxo", "......oo",
];
const POINTER = POINTER_ROWS.flatMap((row, y) => [...row].map((c, x) =>
  c === "." ? null : <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} className={c === "x" ? styles.fill : styles.edge} />));

/** Ease in and out, so the cursor starts and stops softly, as a hand does. */
const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

/**
 * The homepage hero: Alex's real Next week screen, driven by a cursor at a person's pace. The week starts with its
 * empty times, fills from the newsletter one draft at a time, opens a draft as a modal over the week to show its
 * rules and the newsletter quote, approves it, opens the post that cannot go out and shows why, then approves the
 * rest. Every screen is the app's own component with demo data; visitors cannot click into it (the demo is for
 * that). It plays only on screen and pauses while the pointer is over it. Phones get the same story in the draft
 * window alone, which fits their width.
 */
export function HeroWalkthrough({ week, ...props }: WeekProps & { week: NonNullable<WeekProps["week"]> }) {
  const drafts = week.posts.filter((p) => p.status === "draft");
  const others = week.posts.filter((p) => p.status !== "draft");
  // The draft whose own checks fail, and the first one that passes: the two the cursor opens.
  const blocked = drafts.find((d) => d.checks?.some((c) => c.tone === "danger"));
  const first = drafts.find((d) => d !== blocked);
  const blockedReason = blocked?.checks?.find((c) => c.tone === "danger")?.label ?? "a check failed";
  const [shown, setShown] = useState(drafts.length);
  const [windowId, setWindowId] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);
  const [say, setSay] = useState("");
  const [run, setRun] = useState(0);
  const [phone, setPhone] = useState(false);
  const [cursor, setCursor] = useState<{ x: number; y: number; down: boolean } | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const paused = useRef(false);
  const visible = useRef(false);

  useEffect(() => {
    const el = root.current;
    const isPhone = matchMedia("(max-width: 720px)").matches;
    setPhone(isPhone);
    if (!el || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let alive = true;
    let at = { x: el.clientWidth * 0.82, y: el.clientHeight * 0.55 };
    const running = () => !paused.current && visible.current;
    const wait = async (ms: number) => {
      let left = ms;
      while (left > 0 && alive) {
        await new Promise((r) => setTimeout(r, 50));
        if (running()) left -= 50;
      }
    };
    /** Glides to the target on a slight arc; longer moves take longer, as they do for a hand. */
    const moveTo = (target: HTMLElement) => new Promise<void>((done) => {
      const box = el.getBoundingClientRect(), r = target.getBoundingClientRect();
      const to = { x: r.left - box.left + Math.min(r.width * 0.5, 60), y: r.top - box.top + r.height * 0.55 };
      const from = at, dist = Math.hypot(to.x - from.x, to.y - from.y);
      const length = Math.min(1500, Math.max(650, 420 + dist * 0.85));
      const bow = Math.min(36, dist * 0.08);
      let elapsed = 0, last = performance.now();
      const step = (now: number) => {
        if (!alive) return done();
        if (running()) elapsed += now - last;
        last = now;
        const t = Math.min(1, elapsed / length), k = ease(t), lift = Math.sin(t * Math.PI) * bow;
        at = { x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k - lift };
        setCursor({ ...at, down: false });
        if (t < 1) requestAnimationFrame(step); else done();
      };
      requestAnimationFrame(step);
    });
    /** Settles on the target, presses, lets go: the pause before a click is what makes it read as a person. */
    const click = async (target: Target, real = false) => {
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      const t = target(el);
      if (!t) return false;
      await moveTo(t);
      await wait(320);
      setCursor({ ...at, down: true });
      await wait(140);
      setCursor({ ...at, down: false });
      if (real) t.click();
      return true;
    };
    const scrollWindow = async (share: number) => {
      const w = el.querySelector<HTMLElement>("[data-window]");
      w?.scrollTo({ top: (w.scrollHeight - w.clientHeight) * share, behavior: "smooth" });
      await wait(900);
    };
    const open = async (id: string | undefined) => { if (id) { setClosing(false); setWindowId(id); await wait(450); } };
    const close = async () => {
      await click((r) => r.querySelector<HTMLElement>("[data-window] [aria-label='Close dialog']"));
      setClosing(true); await wait(260); setWindowId(null); setClosing(false);
    };
    const inWindow: Target = (r) => byText(r.querySelector("[data-window]") ?? r, (s) => s === "Approve & schedule");

    const desk = async () => {
      setSay(`${countOpenSlots({ ...week, posts: others })} empty times in Alex's week`);
      await wait(2200);
      setSay("Fill them from this week's newsletter");
      await click((r) => byText(r, (s) => s === "Fill next week"));
      await wait(500);
      for (let i = 0; i < drafts.length && alive; i++) {
        setSay(`Writing from This Week in AI 41 and checking it against Alex's rules · ${i + 1} of ${drafts.length}`);
        setShown(i + 1);
        await wait(950);
      }
      setSay(blocked ? `${drafts.length - 1} ready to approve. 1 would fail in Buffer` : `${drafts.length} ready to approve`);
      await wait(2400);
      setSay("Open a draft to see why it passed");
      await click(draftCard(first?.text ?? ""));
      await open(first?.id);
      setSay("It passed Alex's rules and fits LinkedIn");
      await wait(2600);
      setSay("Every quote is matched to the newsletter");
      await scrollWindow(0.55);
      await wait(2400);
      await scrollWindow(1);
      setSay("Alex approves it");
      await click(inWindow, true);
      await wait(1600);
      await close();
      await wait(600);
      if (blocked) {
        setSay("This one is marked: it would fail");
        await click(draftCard(blocked.text));
        await open(blocked.id);
        setSay(`It can't go out: ${blockedReason}`);
        await wait(3400);
        await close();
        await wait(500);
      }
      setSay("Approve the rest in one go");
      await click((r) => byText(r, (s) => /^Approve \d/.test(s)), true);
      await wait(700);
      await click((r) => byText(r, (s) => s.startsWith("Schedule ")), true);
      setSay("Scheduled in Buffer, by Alex's own Approve");
      await wait(3200);
    };
    const handset = async () => {
      await open(first?.id);
      setSay("Written from This Week in AI 41, checked against Alex's rules");
      await wait(3000);
      setSay("Every quote is matched to the newsletter");
      await scrollWindow(0.55);
      await wait(2600);
      await scrollWindow(1);
      setSay("Alex approves it");
      await click(inWindow, true);
      await wait(2000);
      if (blocked) {
        await open(blocked.id);
        setSay(`This one can't go out: ${blockedReason}`);
        await wait(3600);
      }
    };
    const play = async () => {
      while (alive) {
        setShown(isPhone ? drafts.length : 0); setWindowId(null); setRun((n) => n + 1); setCursor(null);
        await wait(700);
        await (isPhone ? handset() : desk());
        setCursor(null);
        await wait(1200);
      }
    };
    const seen = new IntersectionObserver(([e]) => { visible.current = e.isIntersecting; });
    seen.observe(el);
    void play();
    return () => { alive = false; seen.disconnect(); };
    // The script reads the week once; a new week would remount this component.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const current = { ...week, posts: [...others, ...drafts.slice(0, shown)] };
  const draftWindow = (id: string) => (
    <div key={id} className={phone ? styles.phoneWindow : styles.window} data-window data-closing={closing || undefined}>
      <WeekView key={`${run}-${id}`} {...props} week={week} showDraft={id} />
    </div>
  );
  return (
    <div ref={root} className={styles.root} onPointerEnter={() => { paused.current = true; }} onPointerLeave={() => { paused.current = false; }}>
      <div className={styles.stage} inert>
        <ToastStackProvider>
          {phone ? draftWindow(windowId ?? first?.id ?? "") : <>
            <WeekView key={run} {...props} week={current} />
            {windowId && <div className={styles.backdrop} data-closing={closing || undefined} />}
            {windowId && draftWindow(windowId)}
          </>}
        </ToastStackProvider>
      </div>
      {say && <p key={say} className={phone ? styles.phoneSay : styles.say} aria-hidden="true">{say}</p>}
      {cursor && (
        <svg className={styles.cursor} data-down={cursor.down || undefined} style={{ transform: `translate(${cursor.x}px, ${cursor.y}px)` }} viewBox="0 0 11 17" shapeRendering="crispEdges" aria-hidden="true">
          {POINTER}
        </svg>
      )}
    </div>
  );
}
