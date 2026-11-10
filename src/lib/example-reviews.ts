/**
 * @fileoverview The example account's review link: three of Alex's drafts shared on Sunday evening with Isabel, a
 * client, and Sam, a teammate, with their comments pinned to the words they meant. Dated with the rest of the
 * example's story, so it stays in the past while the shown week moves on.
 */
import type { ReviewComment, ReviewLink } from "./review-limits";
import { postText } from "./demo-data";
import { shiftIso, storyShift } from "./demo-clock";

const shared = (id: string, network: string, channel: string) => ({ postId: id, network, channel, dueAt: null, text: postText(id) });

/** A comment pinned to `quote`, which must appear word for word in the draft. */
function pinned(id: string, postId: string, name: string, quote: string, text: string, at: string): ReviewComment {
  const start = postText(postId).indexOf(quote);
  if (start < 0) throw new Error(`The example comment ${id} quotes words that are not in draft ${postId}.`);
  return { id, postId, name, text, quote, start, end: start + quote.length, createdAt: at };
}

/**
 * The example's one review link and its comments, read-only.
 *
 * @param shift - Days the shown week has moved from the written week (demoShiftDays)
 */
export function exampleReviewLinks(shift: number): (ReviewLink & { comments: ReviewComment[] })[] {
  const at = (iso: string) => shiftIso(iso, storyShift(shift));
  return [{
    id: "example",
    createdAt: at("2026-11-01T23:00:00Z"),
    revokedAt: null,
    expiresAt: at("2026-11-08T23:00:00Z"),
    drafts: [shared("d1", "linkedin", "LinkedIn"), shared("d4", "twitter", "X"), shared("d5", "linkedin", "LinkedIn")],
    comments: [
      pinned("c1", "d1", "Isabel", "I want to see it on real repos before I switch", "Which repos? Name one and people will trust the test more.", at("2026-11-02T01:10:00Z")),
      pinned("c2", "d4", "Sam", "That is my test for issue 42.", "Love this. Can we say when issue 42 lands?", at("2026-11-02T01:40:00Z")),
    ],
  }];
}
