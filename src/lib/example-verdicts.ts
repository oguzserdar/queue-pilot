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
    v("r1", "pass", "Gemini 4 Carbon ranks #1 on the Artificial Analysis Intelligence Index, at 59.", "The first line names the model and its score."),
    v("r2", "pass", "", "Says what changed, with no \"game-changer\"."),
    v("r4", "pass", "", "No open-source, and no other word for it."),
  ],
  d2: [v("r3", "pass", "Full notes in the newsletter, link in bio.", "Ends with the line."), v("r4", "pass", "", "No open-source, and no other word for it.")],
  d3: [v("r4", "pass", "", "No open-source, and no other word for it.")],
  d4: [v("r4", "pass", "", "No open-source, and no other word for it.")],
  d5: [
    v("r1", "unsure", "Claude Duet keeps working when you step away", "It names the app first, but the news has no number to lead with."),
    v("r2", "pass", "", "Says what changed, with no \"game-changer\"."),
    v("r4", "pass", "", "No open-source, and no other word for it."),
  ],
};

/** Try a draft's sample text on the example Playbook, and how the judge would answer it. */
export const EXAMPLE_TRY = {
  text: "Un modello open source che cambia le regole del gioco.",
  network: "linkedin",
  verdicts: [
    v("r2", "fail", "cambia le regole del gioco", 'Italian for "game-changer".'),
    v("r4", "fail", "open source", 'Calls a model "open source"; the playbook asks for "open-weights".'),
    v("r1", "fail", "Un modello open source", "The first line names no model and no number."),
  ],
};
