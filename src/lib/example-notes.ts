/**
 * @fileoverview A teammate's note in Alex's example, shown in the same screens a signed-in person sees: Sam's Buffer
 * note on the LinkedIn Gemini 4 Carbon draft (d1), how Queue Pilot classifies it, the two LinkedIn drafts it would
 * change, and the LinkedIn-only rule it becomes when kept. The companies named are the ones that published each piece of
 * news (launch/day8/EXAMPLE-NEWS-SOURCES.md): Google for Gemini 4 Carbon, Anthropic for Claude Duet. Nothing here is
 * a live check, and keeping it changes the example screen only.
 */
import type { TeamNote } from "./note-feedback";
import type { FeedbackResult } from "./feedback-flow";
import type { ExampleRule } from "./example-playbook";
import { posts } from "./demo-data";

const text = (id: string) => posts.find((p) => p.id === id)!.text;
const CARBON = text("d1");
const DUET = text("d5");

/** Sam's note, as Buffer returns it on the open LinkedIn draft. */
export const EXAMPLE_TEAM_NOTE: TeamNote = {
  key: "note:example-sam-d1",
  postId: "d1",
  channelId: "linkedin",
  account: "Alex Rivera",
  network: "linkedin",
  post: CARBON,
  author: "Sam",
  at: "2026-11-01T21:05:00Z",
  text: "On LinkedIn, can we always say whose model it is the first time? Google's Gemini 4 Carbon, not just Gemini 4 Carbon.",
};

/** The LinkedIn drafts the note is compared with, by id, in the words the finder shows. */
export const EXAMPLE_NOTE_DRAFTS: Record<string, string> = { d1: "LinkedIn, Tuesday 12:00", d5: "LinkedIn, Thursday 15:00" };

const PREFERENCE = "Name the company with the model the first time, as in \"Google's Gemini 4 Carbon\".";

/** How Queue Pilot answers for Sam's note: a lasting preference, two LinkedIn drafts to change, one account's rule. */
export const EXAMPLE_NOTE_PLAN: FeedbackResult = {
  kind: "preference",
  reason: "Sam asks for this on every LinkedIn post (\"always\"), not only on this draft, so it is a lasting preference for that account.",
  preference: PREFERENCE,
  edits: [
    { postId: "d1", before: CARBON, after: CARBON.replace("Gemini 4 Carbon", "Google's Gemini 4 Carbon"), problem: "Names Google, which published Gemini 4 Carbon." },
    { postId: "d5", before: DUET, after: DUET.replace("Claude Duet", "Anthropic's Claude Duet"), problem: "Names Anthropic, which published Claude Duet." },
  ],
  suggestionToken: "example",
  check: "judged",
  refused: [],
  checked: 2,
  flags: [],
};

/** The rule Sam's note becomes when Alex keeps it: LinkedIn only, with the note recorded as where it came from. */
export const EXAMPLE_NOTE_RULE: ExampleRule = {
  id: "r-note-sam", kind: "guidance", channels: "all", accountIds: ["linkedin"], level: "warn", text: PREFERENCE,
  learnedFrom: { kind: "note", note: EXAMPLE_TEAM_NOTE.text, author: "Sam", at: EXAMPLE_TEAM_NOTE.at, postId: "d1", channelId: "linkedin", account: "Alex Rivera", network: "linkedin" },
  origin: "A note from Sam on 1 Nov",
};
