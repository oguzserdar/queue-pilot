/**
 * @fileoverview The example week's props for the week view, built in one place for the demo's Next week page and the
 * landing page's tour, so both always show the same week. `shift` comes from demoShiftDays() on the server.
 */
import { demoWeekFor } from "./demo-data";
import { exampleApprovalsFor, exampleEvidenceFor, exampleNotes, exampleRules, exampleTags, exampleWriting } from "./example-week-extras";
import { countOpenSlots } from "./week-model";

/**
 * Alex's example week moved to next week by `shift` days, with its quotes, notes, tags, rules and approvals.
 *
 * @param shift - Days from demoShiftDays()
 * @returns The week view's props for the example
 */
export function exampleWeekProps(shift: number) {
  const week = demoWeekFor(shift);
  const ids = week.posts.filter((p) => p.status === "draft").map((p) => p.id);
  return {
    week, evidence: exampleEvidenceFor(shift), notesPreview: exampleNotes(ids, shift), tagsPreview: exampleTags(ids),
    rules: exampleRules, writing: exampleWriting, writeCount: countOpenSlots(week), approvals: exampleApprovalsFor(shift),
  };
}
