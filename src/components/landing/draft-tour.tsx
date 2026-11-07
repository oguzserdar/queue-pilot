"use client";

import type { ComponentProps } from "react";
import { WeekView } from "@/components/week-view";
import { SameFixOffer } from "@/components/playbook-view";
import { ToastStackProvider } from "@/registry/components/toast-stack/toast-stack";
import { PointerTour, byText, type TourStop } from "./pointer-tour";
import styles from "./pointer-tour.module.css";

const STOPS: TourStop[] = [
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

/** The real draft window, toured part by part. Its close button is hidden: there is nothing to close here. */
export function DraftTour(props: ComponentProps<typeof WeekView>) {
  return <PointerTour stops={STOPS} className={styles.noClose}><ToastStackProvider><WeekView {...props} /></ToastStackProvider></PointerTour>;
}

const SAME_FIX: TourStop[] = [
  { find: (r) => r.querySelector<HTMLElement>("del") ?? undefined, title: "Your edit in Buffer",
    text: "You cut the opening line and led with what happened." },
  { find: (r) => byText(r, (s) => s.startsWith("On Instagram")), title: "Spotted twice",
    text: "The same fix on two posts, so it is probably a habit worth keeping." },
  { find: (r) => byText(r, (s) => s.startsWith("Keep as a rule:")), title: "One rule for every AI",
    text: "Kept, it is checked on every draft, whichever AI writes it." },
  { find: (r) => byText(r, (s) => s === "Keep as a rule"), title: "Your call",
    text: "Keep it, or Not now. Nothing changes until you choose." },
];

/** The same-fix offer from the playbook, toured the same way. */
export function SameFixTour() {
  return <PointerTour stops={SAME_FIX}><SameFixOffer /></PointerTour>;
}
