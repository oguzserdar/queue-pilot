"use client";

import type { ComponentProps } from "react";
import { WeekView } from "@/components/week-view";
import { EXAMPLE_SAME_FIX, SameFixOffer } from "@/components/playbook-view";
import { TeamNotesFinder } from "@/components/team-notes-finder";
import { ToastStackProvider } from "@/registry/components/toast-stack/toast-stack";
import { PointerTour, byText, type TourStop } from "./pointer-tour";
import styles from "./pointer-tour.module.css";

/** The smallest element whose text passes the test: a whole block, found by what it says. */
const block = (test: (s: string) => boolean) => (r: HTMLElement) => byText(r, test);

/** The first element carrying a CSS module class that ends in `_name`, outside folded parts: the app's own blocks. */
const part = (name: string) => (r: HTMLElement) =>
  [...r.querySelectorAll<HTMLElement>(`[class*="_${name}"]`)].find((el) =>
    [...el.classList].some((c) => c.endsWith(`_${name}`)) && !el.closest("details:not([open])"));

const STOPS: TourStop[] = [
  { find: part("postText"), title: "A draft in your Buffer week",
    text: "Your AI wrote it for an empty LinkedIn time. It waits in Buffer as a draft." },
  { find: part("pair"), title: "Quotes match the source",
    text: "Each quote is matched word for word to the page it came from." },
  { find: part("checks"), title: "Checked before Buffer",
    text: "Your playbook rules, and whether this channel can take the post right now." },
  { find: part("notes"), title: "Notes from your team",
    text: "Teammates leave notes on the draft. Type @ to mention someone." },
  { find: (r) => byText(r, (s) => s === "Edit"), title: "Change it, then approve",
    text: "Edit here or in Buffer. Approving is what schedules it." },
];

/** The real draft window, toured part by part. Its close button is hidden: there is nothing to close here. */
export function DraftTour(props: ComponentProps<typeof WeekView>) {
  return <PointerTour stops={STOPS} className={styles.noClose}><ToastStackProvider><WeekView {...props} /></ToastStackProvider></PointerTour>;
}

const SAME_FIX: TourStop[] = [
  { find: (r) => r.querySelector<HTMLElement>("del")?.closest("p") ?? undefined, title: "Your edit in Buffer",
    text: "You cut the opening line and led with what happened." },
  { find: block((s) => s.startsWith("On Instagram")), title: "Spotted twice",
    text: "The same fix on two posts, so it is probably a habit worth keeping." },
  { find: block((s) => s.startsWith("Keep as a rule:")), title: "One rule for every AI",
    text: "Kept, it is checked on every draft, whichever AI writes it." },
  { find: block((s) => s.includes("Keep as a rule") && s.includes("Not now") && !s.includes("Start with")), title: "Your call",
    text: "Keep it, or Not now. Nothing changes until you choose." },
];

/** The same-fix offer from the playbook, toured the same way. */
export function SameFixTour() {
  return <PointerTour stops={SAME_FIX}><SameFixOffer content={EXAMPLE_SAME_FIX} /></PointerTour>;
}

const TEAM_NOTE: TourStop[] = [
  { find: (r) => r.querySelector<HTMLElement>("blockquote") ?? undefined, title: "A teammate's note in Buffer",
    text: "Sam left it on a LinkedIn draft. Queue Pilot reads it and never follows instructions in it." },
  { find: block((s) => s.startsWith("Sam asks for this")), title: "Read as a lasting wish",
    text: "\"Always\" means every LinkedIn post, not only this draft." },
  { find: block((s) => s.startsWith("Only Alex Rivera")), title: "A rule for one account",
    text: "Kept, it applies to the LinkedIn account it was written on. Your other accounts stay as they are." },
];

/** A teammate's note becoming a rule for one account: the real notes screen in example mode, already read. `shift` is demoShiftDays() from the page. */
export function TeamNoteTour({ shift }: { shift: number }) {
  return <PointerTour stops={TEAM_NOTE}><ToastStackProvider><div className={styles.padded}><TeamNotesFinder example open shift={shift} /></div></ToastStackProvider></PointerTour>;
}
