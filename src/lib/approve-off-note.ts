/**
 * @fileoverview The line beside a switched-off Approve button in the draft window. Kept apart from draft-readiness,
 * which hashes the playbook with node:crypto and so cannot load in the browser.
 */
import type { Readiness } from "./draft-readiness";

/**
 * Says what turns Approve back on. The reason itself already shows once under Checks, so this does not repeat it.
 *
 * @param r - The draft's readiness; only "check" and "breaks" switch Approve off
 * @returns A short plain sentence, or undefined when Approve is not off for a playbook reason
 */
export function approveOffNote(r: Readiness | undefined): string | undefined {
  if (r?.state === "breaks") return "Approve stays off while it breaks a rule. Edit it, then check again.";
  if (r?.state === "check") return "Approve stays off until a fresh check passes.";
  return undefined;
}
