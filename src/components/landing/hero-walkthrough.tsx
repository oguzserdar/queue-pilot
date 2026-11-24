"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type ComponentProps } from "react";
import { ToastStackProvider } from "@/registry/components/toast-stack/toast-stack";
import { WeekView } from "@/components/week-view";
import { countOpenSlots } from "@/lib/week-model";
import { Pause, Play } from "lucide-react";
import styles from "./hero-walkthrough.module.css";

type WeekProps = ComponentProps<typeof WeekView>;
type Target = (root: HTMLElement) => HTMLElement | null | undefined;
/** One of the five steps the walkthrough explains: which step, its title, and what the screen shows right now. */
type Step = { n: number; title: string; text: string };
const STEPS = ["Your empty times", "Drafts from your own work", "Every draft is checked", "Problems are caught first", "You approve, Buffer schedules"] as const;

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
const POINTER = POINTER_ROWS.flatMap((row, y) => row.split("").map((c, x) =>
  c === "." ? null : <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} className={c === "x" ? styles.fill : styles.edge} />));

/** Ease in and out, so the cursor starts and stops softly, as a hand does. */
const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

type Post = NonNullable<WeekProps["week"]>["posts"][number];
type Cursor = { x: number; y: number; down: boolean };

/** What the tour moves on screen: the drafts shown, the open draft window, the words, and the cursor. */
type Stage = {
  el: HTMLElement;
  isAlive: () => boolean;
  /** Not hovered, not paused with the button, and on screen. */
  isRunning: () => boolean;
  showDrafts: (n: number) => void;
  setWindow: (id: string | null) => void;
  setClosing: (closing: boolean) => void;
  say: (step: Step) => void;
  restart: () => void;
  setCursor: (cursor: Cursor | null) => void;
};

/** The week's facts the story tells: its drafts, the first that passes, the one held back and why, and the open times. */
type Story = { drafts: Post[]; first: Post | undefined; blocked: Post | undefined; blockedReason: string; openSlots: number };

/** The hand that plays the tour: waits that stop while paused, a cursor that glides and clicks, and the draft window. */
function tourHand(stage: Stage) {
  const { el } = stage;
  let at = { x: el.clientWidth * 0.82, y: el.clientHeight * 0.55 };
  const wait = async (ms: number) => {
    let left = ms;
    while (left > 0 && stage.isAlive()) {
      await new Promise((r) => setTimeout(r, 50));
      if (stage.isRunning()) left -= 50;
    }
  };
  /** Glides to the target on a slight arc; longer moves take longer, as they do for a hand. */
  const moveTo = (target: HTMLElement) => new Promise<void>((done) => {
    const box = el.getBoundingClientRect(), r = target.getBoundingClientRect();
    const to = { x: r.left - box.left + Math.min(r.width * 0.5, 60), y: r.top - box.top + r.height * 0.55 };
    const from = at, dist = Math.hypot(to.x - from.x, to.y - from.y);
    const length = Math.min(1000, Math.max(450, 300 + dist * 0.55));
    const bow = Math.min(36, dist * 0.08);
    let elapsed = 0, last = performance.now();
    const step = (now: number) => {
      if (!stage.isAlive()) return done();
      if (stage.isRunning()) elapsed += now - last;
      last = now;
      const t = Math.min(1, elapsed / length), k = ease(t), lift = Math.sin(t * Math.PI) * bow;
      at = { x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k - lift };
      stage.setCursor({ ...at, down: false });
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
    await wait(200);
    stage.setCursor({ ...at, down: true });
    await wait(120);
    stage.setCursor({ ...at, down: false });
    if (real) t.click();
    return true;
  };
  const scrollWindow = async (share: number) => {
    const w = el.querySelector<HTMLElement>("[data-window]");
    w?.scrollTo({ top: (w.scrollHeight - w.clientHeight) * share, behavior: "smooth" });
    await wait(650);
  };
  const open = async (id: string | undefined) => { if (id) { stage.setClosing(false); stage.setWindow(id); await wait(380); } };
  const close = async () => {
    await click((r) => r.querySelector<HTMLElement>("[data-window] [aria-label='Close dialog']"));
    stage.setClosing(true); await wait(260); stage.setWindow(null); stage.setClosing(false);
  };
  return { wait, click, scrollWindow, open, close };
}

type Hand = ReturnType<typeof tourHand>;
const sayStep = (stage: Stage, n: number, text: string) => stage.say({ n, title: STEPS[n - 1], text });
const CHECKED = "Each draft is checked against your rules, the quotes in your source, and what Buffer accepts.";
const PASSED = "This one passed your rules, and its quote matches the newsletter word for word.";
const APPROVE = "Approve one draft, or every ready one at once. Approve is what schedules them in Buffer.";
const heldBack = (reason: string) => `A post that would fail is held back with the reason: ${reason}`;

/** The desktop story: the week fills, one draft opens and passes, the failing one shows why, then Approve schedules. */
async function deskStory(stage: Stage, hand: Hand, story: Story) {
  const { wait, click, scrollWindow, open, close } = hand;
  const { drafts, first, blocked } = story;
  sayStep(stage, 1, `Queue Pilot reads your Buffer week and finds the times with no post: ${story.openSlots} here.`);
  await wait(2000);
  sayStep(stage, 2, "Your AI writes a post for each empty time from your latest newsletter issue.");
  await click((r) => byText(r, (s) => s === "Fill next week"));
  await wait(350);
  for (let i = 0; i < drafts.length && stage.isAlive(); i++) { stage.showDrafts(i + 1); await wait(650); }
  await wait(900);
  sayStep(stage, 3, CHECKED);
  await click(draftCard(first?.text ?? ""));
  await open(first?.id);
  await wait(1800);
  sayStep(stage, 3, PASSED);
  await scrollWindow(0.55);
  await wait(2200);
  await close();
  await wait(350);
  if (blocked) {
    sayStep(stage, 4, heldBack(story.blockedReason));
    await click(draftCard(blocked.text));
    await open(blocked.id);
    await wait(2600);
    await close();
    await wait(350);
  }
  sayStep(stage, 5, APPROVE);
  await click((r) => byText(r, (s) => /^Approve \d/.test(s)), true);
  await wait(450);
  await click((r) => byText(r, (s) => s.startsWith("Schedule ")), true);
  await wait(2400);
}

/** The phone story, told in the draft window alone: a passing draft, the failing one, then Approve & schedule. */
async function phoneStory(stage: Stage, hand: Hand, story: Story) {
  const { wait, click, scrollWindow, open } = hand;
  const { first, blocked } = story;
  sayStep(stage, 3, CHECKED);
  await open(first?.id);
  await wait(2000);
  sayStep(stage, 3, PASSED);
  await scrollWindow(0.55);
  await wait(2000);
  if (blocked) {
    sayStep(stage, 4, heldBack(story.blockedReason));
    await open(blocked.id);
    await wait(2600);
  }
  sayStep(stage, 5, APPROVE);
  await open(first?.id);
  await scrollWindow(1);
  await click((r) => byText(r.querySelector("[data-window]") ?? r, (s) => s === "Approve & schedule"), true);
  await wait(1600);
}

/** Plays the story on a loop until the stage is gone, starting each round from the empty (or, on a phone, full) week. */
async function playTour(stage: Stage, story: Story, phone: boolean) {
  const hand = tourHand(stage);
  while (stage.isAlive()) {
    stage.showDrafts(phone ? story.drafts.length : 0); stage.setWindow(null); stage.restart(); stage.setCursor(null);
    await hand.wait(400);
    await (phone ? phoneStory(stage, hand, story) : deskStory(stage, hand, story));
    stage.setCursor(null);
    await hand.wait(800);
  }
}

/** The step's words over the stage. */
function StepWords({ say, phone }: { say: Step; phone: boolean }) {
  return (
    <p className={phone ? styles.phoneSay : styles.say} aria-hidden="true">
      <span className={styles.stepNo}>{say.n}/{STEPS.length}</span><b>{say.title}</b><span className={styles.stepText}>{say.text}</span>
    </p>
  );
}

/**
 * Whether the hero plays as a phone, read once when it loads: the story it plays is chosen then, so a later resize
 * does not swap the layout under it. Cleared when the hero unmounts, so the next one reads the screen again.
 */
let phoneOnLoad: boolean | null = null;
const readPhone = () => (phoneOnLoad ??= matchMedia("(max-width: 720px)").matches);
/** The server draws the desktop week; the browser switches to the phone story after load. */
const notPhoneOnServer = () => false;
/** The answer never changes while the hero is on screen, so there is nothing to subscribe to. */
const noChanges = () => () => {};

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
  const [say, setSayState] = useState<Step | null>(null);
  const [run, setRun] = useState(0);
  const phone = useSyncExternalStore(noChanges, readPhone, notPhoneOnServer);
  const [cursor, setCursor] = useState<{ x: number; y: number; down: boolean } | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const paused = useRef(false);
  // A real control, not only hover: moving content longer than five seconds needs one a keyboard can reach.
  const [stopped, setStopped] = useState(false);
  const stoppedRef = useRef(false);
  const visible = useRef(false);
  // The script reads the week once, as it was first drawn; a new week would remount this component.
  const [story] = useState<Story>(() => ({ drafts, first, blocked, blockedReason, openSlots: countOpenSlots({ ...week, posts: others }) }));

  useEffect(() => {
    const el = root.current;
    const isPhone = readPhone();
    if (!el || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let alive = true;
    const stage: Stage = {
      el,
      isAlive: () => alive,
      isRunning: () => !paused.current && !stoppedRef.current && visible.current,
      showDrafts: setShown,
      setWindow: setWindowId,
      setClosing,
      say: setSayState,
      restart: () => setRun((n) => n + 1),
      setCursor,
    };
    const seen = new IntersectionObserver(([e]) => { visible.current = e.isIntersecting; });
    seen.observe(el);
    void playTour(stage, story, isPhone);
    return () => { alive = false; seen.disconnect(); phoneOnLoad = null; };
  }, [story]);

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
      <button type="button" className={styles.pause} aria-pressed={stopped} onClick={() => { stoppedRef.current = !stopped; setStopped(!stopped); }}>
        {stopped ? <Play size={14} strokeWidth={2} aria-hidden="true" /> : <Pause size={14} strokeWidth={2} aria-hidden="true" />}
        {stopped ? "Play" : "Pause"}
      </button>
      {say && <StepWords key={`${say.n}-${say.text}`} say={say} phone={phone} />}
      {cursor && (
        <svg className={styles.cursor} data-down={cursor.down || undefined} style={{ transform: `translate(${cursor.x}px, ${cursor.y}px)` }} viewBox="0 0 11 17" shapeRendering="crispEdges" aria-hidden="true">
          {POINTER}
        </svg>
      )}
    </div>
  );
}
