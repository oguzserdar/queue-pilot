/**
 * @fileoverview The parts of Alex's example week that the signed-in week shows beside each draft: the source quotes
 * behind it, a Note, its tags, the rules set for its account and the writer's availability. The example renders the
 * same screen as a signed-in person sees, so every section the live draft window has needs example data here; keep this
 * in step with the live week (see week-view.tsx). Example edits change the screen only.
 */
import type { EvidenceCard } from "./source-presentation";
import type { DraftNote } from "@/app/(app)/note-actions";
import type { NoteTeammate } from "./note-mention-picker";
import type { DraftTag } from "@/app/(app)/tag-actions";
import type { Rule } from "./rules";
import type { WritingAvailability } from "./writing-availability";
import { EXAMPLE_RULES } from "./example-playbook";
import { APPROVED_IN_APP, approverLine } from "./rule-origin";
import { exampleTeamNote } from "./example-notes";
import { shiftIso, storyShift } from "./demo-clock";

const CHECKED = "2026-11-01T18:00:00Z";
/** Primary sources behind the example drafts: the company's own page for each piece of news, read 6 Nov 2026. */
const SOURCES = {
  carbon: { snapshotId: "example-carbon", sourceKey: "web:gemini-4-carbon", title: "Gemini 4 Carbon: our next frontier model", uri: "https://blog.google/innovation-and-ai/models-and-research/gemini-models/introducing-gemini-4-carbon/" },
  studio: { snapshotId: "example-studio", sourceKey: "web:android-studio-agents", title: "Your favorite agents are now integrated in Android Studio", uri: "https://developer.android.com/blog/posts/ai-agents-android-studio-integration" },
  terra: { snapshotId: "example-terra", sourceKey: "web:gpt-6-1-terra", title: "GPT-6.1 Terra system card addendum", uri: "https://deploymentsafety.openai.com/gpt-6-1-terra" },
  duet: { snapshotId: "example-duet", sourceKey: "web:claude-duet", title: "Introducing Claude Duet", uri: "https://claude.com/resources/articles/claude-duet" },
};
const card = (postId: string, source: keyof typeof SOURCES, claim: string, quote: string): EvidenceCard => ({
  postId, ...SOURCES[source], claim, quote, locator: null, lastCheckedAt: CHECKED,
  needsCheck: false, changed: false, scheduled: false, editable: true, oldText: "", newText: "", draftText: "", why: "",
});

const TERRA = "GPT-6.1 Terra is a fast, efficient model for high-volume professional work, with strong image analysis and computer use capabilities.";
const AGENTS = "You can choose from over 40 coding agents";

/** The quotes from each primary source that the example drafts' claims rest on, copied word for word. */
const EVIDENCE: EvidenceCard[] = [
  card("d1", "carbon", "Gemini 4 Carbon ranks #1 on the Artificial Analysis Intelligence Index, at 59.", "Carbon ranks #1 on the recently updated v5.0 of Artificial Analysis Intelligence Index at 59."),
  card("d1", "carbon", "For now only a subset of cyber defenders can use it.", "Starting this week, we will make Carbon available to a subset of cyber defenders"),
  card("d2", "studio", "Android Studio now lets you pick from over 40 coding agents.", AGENTS),
  card("d3", "terra", "GPT-6.1 Terra", TERRA),
  card("d3", "studio", "over 40 coding agents in Android Studio", AGENTS),
  card("d4", "terra", "GPT-6.1 Terra is OpenAI's new fast model for high-volume work and computer use.", TERRA),
  card("d5", "duet", "Claude Duet keeps working when you step away and checks with you before it acts.", "It comes to you with what needs your attention, completes tasks you ask of it, keeps working even when you step away, and checks with you before it acts on your behalf."),
  card("d5", "duet", "It is a research preview, in the Pro, Max and Ultra plans.", "For this research preview, Claude Duet is included in Pro, Max, and Ultra plans and uses the same usage limits as the rest of Claude."),
];

/** The evidence cards, each last checked the evening the newsletter went out, moved by `shift` days. */
export const exampleEvidenceFor = (shift: number): EvidenceCard[] => EVIDENCE.map((c) => ({ ...c, lastCheckedAt: c.lastCheckedAt && shiftIso(c.lastCheckedAt, storyShift(shift)) }));

const noteOn = (shift: number): Record<string, DraftNote[]> => ({
  // Newest first, as Buffer returns them. Sam's note is the one the Playbook turns into a LinkedIn rule (example-notes.ts).
  d1: [
    { id: "n2", author: "Sam", avatar: null, createdAt: exampleTeamNote(shift).at!, edited: false, text: exampleTeamNote(shift).text, canEdit: false, canDelete: false },
    { id: "n1", author: "Alex Rivera", avatar: null, createdAt: shiftIso("2026-11-01T19:10:00Z", storyShift(shift)), edited: false, text: "Add the SEC-bench Pro chart from the Google post before this goes out.", canEdit: true, canDelete: true },
  ],
});
/** The teammate Alex can @mention in a note: Sam, who can read notes on every example channel. */
export const EXAMPLE_TEAMMATES: NoteTeammate[] = [{ urn: "urn:buffer:account:example-sam", name: "Sam", email: "sam@example.com", avatar: null, locked: false }];

/** Notes on each example draft, as Buffer would return them. Alex works with Sam, so notes are worded for a team. */
export const exampleNotes = (ids: string[], shift: number) => Object.fromEntries(ids.map((id) => [id, { notes: noteOn(shift)[id] ?? [], more: false, team: true, teammates: EXAMPLE_TEAMMATES }]));

const TAGS: DraftTag[] = [{ id: "t1", name: "Releases", color: "#8F2457" }, { id: "t2", name: "Agents", color: "#2F6F4E" }, { id: "t3", name: "Newsletter", color: "#3B5BA5" }];
/** Tags on each example draft, from Alex's three Buffer tags. */
export const exampleTags = (ids: string[]) => Object.fromEntries(ids.map((id) => [id, { selected: id === "d1" || id === "d3" || id === "d4" ? [TAGS[0]] : id === "d2" || id === "d5" ? [TAGS[1]] : [], all: TAGS, canEdit: true }]));

/** Alex's playbook, which the draft window summarises per account. */
export const exampleRules: Rule[] = EXAMPLE_RULES;

/** The last approval recorded through Queue Pilot for the example's scheduled posts, as the week shows it under each one. */
export const exampleApprovalsFor = (shift: number): Record<string, string> => ({ p1: approverLine(APPROVED_IN_APP, shiftIso("2026-11-01T20:00:00Z", storyShift(shift)))! });

/** The example writer: built-in AI, ready. Pressing it on the example changes nothing. */
export const exampleWriting: WritingAvailability = { ready: true, source: "built-in AI" };
