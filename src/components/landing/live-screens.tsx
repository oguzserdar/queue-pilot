"use client";

import type { ComponentProps } from "react";
import { ToastStack, ToastStackProvider } from "@/registry/components/toast-stack/toast-stack";
import { WeekView } from "@/components/week-view";
import { EXAMPLE_SAME_FIX, SameFixOffer } from "@/components/playbook-view";

/**
 * The homepage's live version: the app's own components with Alex's demo data, not screenshots, so the homepage changes
 * when the app does. They get the same toast provider the app shell gives them; example clicks change the screen only.
 */
export function LiveWeek(props: ComponentProps<typeof WeekView>) {
  return <ToastStackProvider><WeekView {...props} /><ToastStack /></ToastStackProvider>;
}

/** The one-card offer from the playbook; Keep and Not now are inert here. */
export function LiveSameFix() {
  return <SameFixOffer content={EXAMPLE_SAME_FIX} />;
}
