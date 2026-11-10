/**
 * @fileoverview The example review link pins each comment to words that are really in its draft.
 * @module lib/example-reviews.test
 */
import { describe, expect, it } from "vitest";
import { exampleReviewLinks } from "./example-reviews";

describe("exampleReviewLinks", () => {
  it("pins every comment to the exact words it quotes", () => {
    const [link] = exampleReviewLinks(14);
    for (const c of link.comments) {
      const draft = link.drafts.find((d) => d.postId === c.postId)!;
      expect(draft.text.slice(c.start!, c.end!)).toBe(c.quote);
    }
  });

  it("keeps the link in the past of the shown week as the calendar moves", () => {
    const [a] = exampleReviewLinks(0), [b] = exampleReviewLinks(14);
    expect(Date.parse(b.createdAt) - Date.parse(a.createdAt)).toBe(7 * 86_400_000);
  });
});
