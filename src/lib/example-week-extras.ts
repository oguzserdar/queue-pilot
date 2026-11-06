/**
 * @fileoverview The parts of Mark's example week that the signed-in week shows beside each draft: the source quotes
 * behind it, a Note, its tags, the rules set for its account and the writer's availability. The example renders the
 * same screen as a signed-in person sees, so every section the live draft window has needs example data here; keep this
 * in step with the live week (see week-view.tsx). Example edits change the screen only.
 */
import type { EvidenceCard } from "./source-presentation";
import type { DraftNote } from "@/app/(app)/note-actions";
import type { DraftTag } from "@/app/(app)/tag-actions";
import type { Rule } from "./rules";
import type { WritingAvailability } from "./writing-availability";
import { EXAMPLE_RULES } from "./example-playbook";

const CHECKED = "2026-10-25T18:00:00Z";
const issue41 = { snapshotId: "example-41", sourceKey: "feed:weeknight-dinners-41", title: "Weeknight Dinners 41: white bean and kale soup", uri: "https://weeknightdinners.example/41" };
const card = (postId: string, claim: string, quote: string): EvidenceCard => ({
  postId, ...issue41, claim, quote, locator: null, lastCheckedAt: CHECKED,
  needsCheck: false, changed: false, scheduled: false, editable: true, oldText: "", newText: "", draftText: "", why: "",
});

/** The quotes from issue 41 that each example draft's claims rest on. */
export const exampleEvidence: EvidenceCard[] = [
  card("d1", "White bean and kale soup, and the trick for crisp sourdough croutons.", "This week: white bean and kale soup, plus the one trick that keeps sourdough croutons crisp."),
  card("d1", "Weeknight Dinners 41.", "Weeknight Dinners, issue 41."),
  card("d4", "Stale sourdough makes the crispest croutons, in ten minutes.", "Stale sourdough makes the crispest croutons. Ten minutes in a hot pan is all it takes."),
];

const noteOn: Record<string, DraftNote[]> = {
  d1: [{ id: "n1", author: "Mark Evans", avatar: null, createdAt: "2026-10-25T19:10:00Z", edited: false, text: "Swap in the Sunday photo before this goes out.", canEdit: true, canDelete: true }],
};
/** Notes on each example draft, as Buffer would return them. */
export const exampleNotes = (ids: string[]) => Object.fromEntries(ids.map((id) => [id, { notes: noteOn[id] ?? [], more: false, team: false }]));

const TAGS: DraftTag[] = [{ id: "t1", name: "Soups", color: "#8F2457" }, { id: "t2", name: "Weeknight", color: "#2F6F4E" }, { id: "t3", name: "Newsletter", color: "#3B5BA5" }];
/** Tags on each example draft, from Mark's three Buffer tags. */
export const exampleTags = (ids: string[]) => Object.fromEntries(ids.map((id) => [id, { selected: id === "d1" || id === "d3" || id === "d4" ? [TAGS[0]] : [], all: TAGS, canEdit: true }]));

/** Mark's playbook, which the draft window summarises per account. */
export const exampleRules: Rule[] = EXAMPLE_RULES;

/** The example writer: built-in AI, ready. Pressing it on the example changes nothing. */
export const exampleWriting: WritingAvailability = { ready: true, source: "built-in AI" };
