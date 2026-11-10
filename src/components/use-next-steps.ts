"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { useToastStack } from "@/registry/components/toast-stack/toast-stack";
import type { NextStep } from "@/lib/next-step";

const SEEN = "qp-next-step-seen";

/**
 * Shows the suggestions an action returned as toasts, each with a button to the page that acts on it.
 *
 * A suggestion that only improves the next run (voice, connecting an AI) is shown once per browser session; one that
 * explains why this run wrote nothing is shown every time.
 *
 * @returns A stable function that takes the action's `next` list
 *
 * @example
 * ```tsx
 * const suggest = useNextSteps();
 * const r = await writeMyWeek();
 * suggest(r.next);
 * ```
 */
export function useNextSteps(): (steps: NextStep[] | undefined) => void {
  const { toast } = useToastStack();
  const router = useRouter();
  return useCallback((steps) => {
    for (const s of steps ?? []) {
      if (s.tone === "info") {
        try {
          const seen = (sessionStorage.getItem(SEEN) ?? "").split(",");
          if (seen.includes(s.id)) continue;
          sessionStorage.setItem(SEEN, [...seen, s.id].filter(Boolean).join(","));
        } catch { /* Private windows can refuse storage; the toast still shows. */ }
      }
      toast({ type: s.tone, title: s.title, description: s.description, duration: 12_000, action: { label: s.action.label, onClick: () => router.push(s.action.href) } });
    }
  }, [toast, router]);
}
