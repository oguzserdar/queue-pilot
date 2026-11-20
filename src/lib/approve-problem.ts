/**
 * @fileoverview What to tell the person when an Approve did not schedule everything.
 * @module lib/approve-problem
 */
import type { ApproveActionResult } from "@/app/(app)/actions";

/** A problem to show: a short title and the reasons in full. */
export type ApproveProblem = { title: string; text: string };

/** Why nothing was scheduled, in the words the Approve button shows. */
function failureText(kind: Extract<ApproveActionResult, { ok: false }>["kind"]): string {
  if (kind === "limited") return "Buffer's request limit is reached. Try again in a few minutes.";
  if (kind === "signedOut") return "Your session ended. Sign in with Buffer again.";
  return "Buffer could not be reached.";
}

/**
 * The problem an Approve result carries, or null when every draft was scheduled.
 *
 * @param res - The approve action's answer
 * @returns The title and reasons to show beside the Approve button, or null
 */
export function approveProblem(res: ApproveActionResult): ApproveProblem | null {
  if (!res.ok) return { title: "Nothing was scheduled", text: failureText(res.kind) };
  if (!res.refused.length) return null;
  return { title: `${res.refused.length} draft${res.refused.length === 1 ? " was" : "s were"} not scheduled`, text: res.refused.map((r) => r.reason).join(" ") };
}
