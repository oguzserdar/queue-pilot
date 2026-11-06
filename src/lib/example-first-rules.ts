/**
 * What "Find rules in my past posts" returns for the example account, on Alex's 12 LinkedIn posts and 3 Instagram
 * posts. The shape and verdicts come from a real run of evals/first-rules.eval.ts (EVAL_CLEAN=1, 28 Oct 2026, Claude
 * Haiku); the post text was rewritten by hand on 6 Nov 2026 when the example account changed from a cooking newsletter
 * to This Week in AI. Rerun the eval on matching fixtures and regenerate rather than editing further.
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
          "A new open-weights model finished 9 of 10 tasks in my coding test. I rerun every test myself before I write it up. Which result would you check first?",
          "Three agent frameworks, one refactor: two finished, one looped. Full notes in Sunday's issue. Which framework do you use day to day?"
        ]
      }
    },
    {
      "text": "Say open-weights, never open-source",
      "channels": [
        "linkedin"
      ],
      "where": "LinkedIn",
      "key": "first:linkedin:Say open-weights, never open-source",
      "proof": {
        "kind": "note",
        "note": "Say open-weights, never open-source, for a model. Our readers know the difference.",
        "by": "Sam",
        "at": "2026-10-27T09:00:00Z",
        "post": "An open-source model now runs on a laptop in my tests, 12 tokens a second. Slow, still useful. Would you trade speed for privacy?"
      }
    }
  ]
};
