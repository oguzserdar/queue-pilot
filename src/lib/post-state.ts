/**
 * One status language for posts across the app: the same states, words and marks on every screen. Lists show the
 * mark only; a post's detail shows the word.
 */
import { worstTone } from "./week-model";

export const POST_STATES = ["empty", "draft", "check", "breaks", "scheduled", "sent", "failed"] as const;
export type PostState = (typeof POST_STATES)[number];

/** The word for each state, as the detail panel and screen readers say it. */
export const STATE_WORD: Record<PostState, string> = {
  empty: "Empty",
  draft: "Draft",
  check: "Check",
  breaks: "Breaks a rule",
  scheduled: "Scheduled",
  sent: "Sent",
  failed: "Failed",
};

/** A post's state from its Buffer status and its checks; an approved draft is scheduled. */
export function postState(p: { status: "draft" | "scheduled" | "sent" | "error"; checks?: { tone: string }[] }, approved = false): PostState {
  if (p.status === "error") return "failed";
  if (p.status === "sent") return "sent";
  if (p.status === "scheduled" || approved) return "scheduled";
  const tone = worstTone(p);
  return tone === "danger" ? "breaks" : tone === "warning" ? "check" : "draft";
}
