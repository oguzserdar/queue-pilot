"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { X } from "lucide-react";
import { PilotMark } from "./landing/pilot-mark";
import { SignInButton } from "./sign-in-button";
import styles from "./demo-nudge.module.css";

/** Clicks before the card first appears, and before it comes back once after "Keep exploring". */
export const FIRST_NUDGE = 3;
export const SECOND_NUDGE = 10;
const KEY = "qp-demo-nudge";

/**
 * Whether the demo should ask the visitor to sign in now.
 *
 * @param clicks - Buttons and links the visitor has pressed in the demo this visit
 * @param dismissed - How many times they have closed the card
 * @returns true at the first and second thresholds; never a third time
 */
export function nudgeDue(clicks: number, dismissed: number): boolean {
  if (dismissed === 0) return clicks >= FIRST_NUDGE;
  if (dismissed === 1) return clicks >= SECOND_NUDGE;
  return false;
}

const read = (): { clicks: number; dismissed: number } => {
  try { return { clicks: 0, dismissed: 0, ...JSON.parse(sessionStorage.getItem(KEY) ?? "{}") }; } catch { return { clicks: 0, dismissed: 0 }; }
};
const write = (v: { clicks: number; dismissed: number }) => { try { sessionStorage.setItem(KEY, JSON.stringify(v)); } catch { /* private window: the count lives for this page only */ } };

/**
 * In the demo only: after a few clicks, a small card asks the visitor to do the same with their own Buffer queue.
 * It counts presses on buttons and links anywhere in the app, survives moving between screens for the visit, and
 * comes back once more after "Keep exploring", never a third time.
 */
export function DemoNudge() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let state = read();
    if (nudgeDue(state.clicks, state.dismissed)) setOpen(true);
    const onClick = (e: MouseEvent) => {
      const hit = (e.target as Element | null)?.closest("button, a, [role=button], [role=tab]");
      if (!hit || hit.closest("[data-demo-nudge]")) return;
      state = { ...state, clicks: state.clicks + 1 };
      write(state);
      if (nudgeDue(state.clicks, state.dismissed)) setOpen(true);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);
  const close = () => {
    const s = read();
    write({ ...s, dismissed: s.dismissed + 1 });
    setOpen(false);
  };
  return (
    <AnimatePresence>
      {open && (
        <motion.aside data-demo-nudge className={styles.card} role="complementary" aria-label="Use your own Buffer"
          initial={{ opacity: 0, y: 12, scale: .97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 6, transition: { duration: .14 } }}
          transition={{ type: "spring", duration: .38, bounce: .15 }}>
          <PilotMark className={styles.pilot} />
          <div className={styles.copy}>
            <b>This is Alex&rsquo;s week.</b>
            <p>Sign in with Buffer and I will show you your own empty times.</p>
            <div className={styles.actions}>
              <SignInButton variant="primary" size="sm" returnTo="/" />
              <button type="button" className={styles.later} onClick={close}>Keep exploring</button>
            </div>
          </div>
          <button type="button" className={styles.close} onClick={close} aria-label="Close"><X size={14} strokeWidth={1.75} aria-hidden="true" /></button>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
