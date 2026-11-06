/**
 * @fileoverview The parts of Alex's example week that the signed-in week shows beside each draft: the source quotes
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
const issue41 = { snapshotId: "example-41", sourceKey: "feed:this-week-in-ai-41", title: "This Week in AI 41: four releases, one refactor test", uri: "https://thisweekinai.example/41" };
const card = (postId: string, claim: string, quote: string): EvidenceCard => ({
  postId, ...issue41, claim, quote, locator: null, lastCheckedAt: CHECKED,
  needsCheck: false, changed: false, scheduled: false, editable: true, oldText: "", newText: "", draftText: "", why: "",
});

/** The quotes from issue 41 that each example draft's claims rest on. */
export const exampleEvidence: EvidenceCard[] = [
  card("d1", "A new open-weights coding model finished 9 of 10 refactor tasks in my test.", "The new open-weights coding model finished 9 of the 10 refactor tasks I gave it, the best score I saw this week."),
  card("d1", "This Week in AI 41.", "This Week in AI, issue 41."),
  card("d4", "I gave three agent frameworks the same refactor. Two finished, one looped for an hour.", "I tested three agent frameworks on the same refactor; two finished, one looped for an hour before I stopped it."),
];

const noteOn: Record<string, DraftNote[]> = {
  d1: [{ id: "n1", author: "Alex Rivera", avatar: null, createdAt: "2026-10-25T19:10:00Z", edited: false, text: "Swap in the results chart before this goes out.", canEdit: true, canDelete: true }],
};
/** Notes on each example draft, as Buffer would return them. */
export const exampleNotes = (ids: string[]) => Object.fromEntries(ids.map((id) => [id, { notes: noteOn[id] ?? [], more: false, team: false }]));

const TAGS: DraftTag[] = [{ id: "t1", name: "Releases", color: "#8F2457" }, { id: "t2", name: "Agents", color: "#2F6F4E" }, { id: "t3", name: "Newsletter", color: "#3B5BA5" }];
/** Tags on each example draft, from Alex's three Buffer tags. */
export const exampleTags = (ids: string[]) => Object.fromEntries(ids.map((id) => [id, { selected: id === "d1" || id === "d3" || id === "d4" ? [TAGS[0]] : [], all: TAGS, canEdit: true }]));

/** Alex's playbook, which the draft window summarises per account. */
export const exampleRules: Rule[] = EXAMPLE_RULES;

/** The example writer: built-in AI, ready. Pressing it on the example changes nothing. */
export const exampleWriting: WritingAvailability = { ready: true, source: "built-in AI" };
