/**
 * Playbook verdicts for the example account's drafts, written by hand the way the judge (judge.ts) answers: what a
 * signed-out visitor sees on Next week and in Try a draft. Labelled as examples on screen; nothing here is a live check.
 */
import { EXAMPLE_RULES } from "./example-playbook";
import type { Verdict } from "./judge";

const rule = (id: string) => EXAMPLE_RULES.find((r) => r.id === id)!;
const v = (id: string, verdict: Verdict["verdict"], quote: string, reason: string): Verdict => ({ ruleId: id, rule: rule(id).text, level: rule(id).level, verdict, probability: null, quote, reason });

/** By example draft id (demo-data.ts). */
export const EXAMPLE_VERDICTS: Record<string, Verdict[]> = {
  d1: [
    v("r1", "pass", "White bean and kale soup", "The first line names the soup."),
    v("r2", "pass", "", "The opening is the dish, not an announcement."),
    v("r4", "pass", "", "No broth, and no other word for it."),
  ],
  d2: [v("r3", "pass", "Recipe in the newsletter, link in bio.", "Ends with the line."), v("r4", "pass", "", "No broth, and no other word for it.")],
  d3: [v("r4", "pass", "", "No broth, and no other word for it.")],
  d4: [v("r4", "pass", "", "No broth, and no other word for it.")],
  d5: [
    v("r1", "unsure", "", "It names three swaps, not one dish; the rule may not fit a list post."),
    v("r2", "pass", "", "The opening is the swaps, not an announcement."),
    v("r4", "pass", "", "Stock is the word the playbook asks for."),
  ],
};

/** Try a draft's sample text on the example Playbook, and how the judge would answer it. */
export const EXAMPLE_TRY = {
  text: "Ravi di condividere il mio nuovo brodo per le sere fredde.",
  network: "linkedin",
  verdicts: [
    v("r2", "fail", "Ravi di condividere", 'Italian for "Excited to share".'),
    v("r4", "fail", "brodo", 'Italian for "broth".'),
    v("r1", "fail", "il mio nuovo brodo", "The first line names a broth, not a dish."),
  ],
};
