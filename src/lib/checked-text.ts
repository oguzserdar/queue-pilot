/**
 * @fileoverview Which text a draft's playbook check belongs to.
 * @module lib/checked-text
 */
import type { Written } from "./written-store";

/**
 * The text a draft's verdicts were given for: the last checked text, or what Queue Pilot wrote when never rechecked.
 *
 * @param w - The written record
 * @returns The text to compare with the draft's current text before trusting its verdicts
 */
export function checkedTextOf(w: Pick<Written, "text" | "checkedText">): string {
  return w.checkedText ?? w.text;
}
