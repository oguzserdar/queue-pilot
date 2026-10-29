/**
 * What "Find rules in my past posts" returns for the example account. Generated from a real run of
 * evals/first-rules.eval.ts (EVAL_CLEAN=1) on Mark's 12 LinkedIn posts and 3 Instagram posts (28 Oct 2026, Claude Haiku), not written
 * by hand. Rerun the eval and regenerate rather than editing.
 */
import type { FirstRuleOffer } from "@/app/(app)/actions";

export const EXAMPLE_FIRST_RULES: { offers: FirstRuleOffer[]; skipped: string[] } = {
  "skipped": [
    "Instagram"
  ],
  "offers": [
    {
      "text": "End every post with a question",
      "channels": [
        "linkedin"
      ],
      "where": "LinkedIn",
      "key": "first:linkedin:End every post with a question",
      "proof": {
        "kind": "posts",
        "followed": 12,
        "of": 12,
        "unclear": 0,
        "unclearPosts": [],
        "examples": [
          "Tuesday's chickpea curry takes 25 minutes and one pan. The trick is blooming the spices in oil first. What do you cook when the week runs long?",
          "Tomato and white bean soup, 35 minutes, mostly hands-off. Freezes well for next week. Do you batch cook on Sundays?"
        ]
      }
    },
    {
      "text": "Say stock, never broth",
      "channels": [
        "linkedin"
      ],
      "where": "LinkedIn",
      "key": "first:linkedin:Say stock, never broth",
      "proof": {
        "kind": "note",
        "note": "Say stock, never broth, for this client. Their customers are in the UK.",
        "by": "Sara",
        "at": "2026-10-27T09:00:00Z",
        "post": "Black bean tacos in 15 minutes, using the tin and a lime. Nothing fancy, still good. Corn or flour tortillas?"
      }
    }
  ]
};
