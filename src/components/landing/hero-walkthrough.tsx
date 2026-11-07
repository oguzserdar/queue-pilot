"use client";

import { useEffect, useRef, useState, type ComponentProps } from "react";
import { ToastStackProvider } from "@/registry/components/toast-stack/toast-stack";
import { WeekView } from "@/components/week-view";
import styles from "./hero-walkthrough.module.css";

type WeekProps = ComponentProps<typeof WeekView>;

/** One step of the walkthrough: what the chip says, and what the cursor does. */
type Beat =
  | { say: string; wait: number }
  | { say?: string; point: Target; click?: "real" | "press"; then?: () => void; wait: number };
type Target = (root: HTMLElement) => HTMLElement | null | undefined;

const byText = (root: HTMLElement, test: (s: string) => boolean) =>
  [...root.querySelectorAll<HTMLElement>("button")].find((b) => test((b.textContent ?? "").trim()));
const draftCard = (text: string): Target => (root) => byText(root, (s) => s.includes(text.slice(0, 24)));

/**
 * The homepage hero: Alex's real Next week screen, driven by a scripted cursor. The week starts with its empty times,
 * fills from the newsletter one draft at a time, opens a draft to show its quote and rules, shows why one post cannot
 * go out, then approves the rest. Every screen is the app's own component with demo data; visitors cannot click into
 * it (the demo is for that). It plays only on screen, pauses while the pointer is over it, and shows the finished
 * week, still, when motion is reduced.
 */
export function HeroWalkthrough({ week, ...props }: WeekProps & { week: NonNullable<WeekProps["week"]> }) {
  const drafts = week.posts.filter((p) => p.status === "draft");
  // The draft whose own checks fail, and the first one that passes: the two the cursor opens.
  const blocked = drafts.find((d) => d.checks?.some((c) => c.tone === "danger"));
  const first = drafts.find((d) => d !== blocked);
  const blockedReason = blocked?.checks?.find((c) => c.tone === "danger")?.label ?? "a check failed";
  const others = week.posts.filter((p) => p.status !== "draft");
  const [shown, setShown] = useState(drafts.length);
  const [windowId, setWindowId] = useState<string | null>(null);
  const [say, setSay] = useState("");
  const [run, setRun] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const cursor = useRef<HTMLDivElement>(null);
  const paused = useRef(false);
  const visible = useRef(false);

  useEffect(() => {
    const el = root.current;
    if (!el || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let alive = true;
    const wait = async (ms: number) => {
      let left = ms;
      while (left > 0 && alive) {
        await new Promise((r) => setTimeout(r, 100));
        if (!paused.current && visible.current) left -= 100;
      }
    };
    const moveTo = async (target: HTMLElement) => {
      const box = el.getBoundingClientRect(), r = target.getBoundingClientRect(), c = cursor.current;
      if (!c) return;
      c.style.opacity = "1";
      c.style.transform = `translate(${r.left - box.left + r.width * 0.55}px, ${r.top - box.top + r.height * 0.6}px)`;
      await wait(750);
    };
    const press = async () => {
      cursor.current?.setAttribute("data-press", "");
      await wait(160);
      cursor.current?.removeAttribute("data-press");
    };
    const beats: Beat[] = [
      { say: `${drafts.length} empty times in Alex's week`, wait: 1200 },
      { say: "Fill next week, from This Week in AI", point: (r) => byText(r, (s) => s === "Fill next week"), click: "press", wait: 300 },
      ...drafts.map((d, i): Beat => ({ say: `Writing from the newsletter, checking each against Alex's rules · ${i + 1} of ${drafts.length}`, wait: 0, point: () => null, then: () => setShown(i + 1) })),
      { say: blocked ? `${drafts.length - 1} ready to approve · 1 would fail in Buffer` : `${drafts.length} ready to approve`, wait: 1400 },
      { say: "Every quote is matched to the source", point: draftCard(first?.text ?? ""), click: "press", then: () => setWindowId(first?.id ?? null), wait: 2600 },
      { say: "Alex approves this one", point: (r) => byText(r.querySelector("[data-window]") as HTMLElement ?? r, (s) => s === "Approve & schedule"), click: "real", wait: 1400 },
      ...(blocked ? [{ say: `This one can't go out: ${blockedReason}`, point: draftCard(blocked.text), click: "press" as const, then: () => setWindowId(blocked.id), wait: 2800 }] : []),
      { say: "Approve the rest in one go", point: (r) => { setWindowId(null); return byText(r, (s) => /^Approve \d/.test(s)); }, click: "real", wait: 500 },
      { say: "Scheduled in Buffer, by Alex's own Approve", point: (r) => byText(r, (s) => s.startsWith("Schedule ")), click: "real", wait: 2600 },
    ];
    const play = async () => {
      while (alive) {
        setShown(0); setWindowId(null); setRun((n) => n + 1);
        if (cursor.current) cursor.current.style.opacity = "0";
        await wait(500);
        for (const beat of beats) {
          if (!alive) return;
          if (beat.say) setSay(beat.say);
          if ("point" in beat) {
            // Let React draw the previous step before the cursor looks for its next target.
            await new Promise((r) => requestAnimationFrame(() => r(null)));
            const target = beat.point(el);
            if (target) {
              await moveTo(target);
              if (beat.click) await press();
              if (beat.click === "real") target.click();
            } else if (!beat.then) continue;
            beat.then?.();
            await wait(beat.wait || 380);
          } else await wait(beat.wait);
        }
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
  return (
    <div ref={root} className={styles.root} onPointerEnter={() => { paused.current = true; }} onPointerLeave={() => { paused.current = false; }}>
      <div className={styles.stage} inert>
        <ToastStackProvider>
          <WeekView key={run} {...props} week={current} />
          {windowId && (
            <div className={styles.window} data-window>
              <WeekView key={`${run}-${windowId}`} {...props} week={week} showDraft={windowId} />
            </div>
          )}
        </ToastStackProvider>
      </div>
      {say && <p className={styles.say} aria-hidden="true">{say}</p>}
      <div ref={cursor} className={styles.cursor} aria-hidden="true">
        <svg viewBox="0 0 16 20" width="18" height="22"><path d="M1 1 L1 15 L5 11.5 L8 18 L10.5 17 L7.6 10.6 L13 10.6 Z" fill="#1C1A1F" stroke="#fff" strokeWidth="1.2" strokeLinejoin="round" /></svg>
      </div>
    </div>
  );
}
