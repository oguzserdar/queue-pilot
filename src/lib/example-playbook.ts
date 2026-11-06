/**
 * The example account's playbook, shared by the Playbook screen and the week view so both check drafts against the
 * same rules. Alex Rivera writes This Week in AI; these are fixes Alex made more than once.
 */
import type { Rule } from "./rules";

export type ExampleRule = Rule & { origin: string };

export const EXAMPLE_RULES: ExampleRule[] = [
  { id: "r1", kind: "guidance", channels: ["linkedin"], level: "warn", text: "Name the model and the number in the first line.", origin: "You moved the model and its score to the front in 3 drafts" },
  { id: "r2", kind: "banned", phrases: ["game-changer"], channels: ["linkedin"], level: "block", text: 'No "game-changer". Say what changed.', origin: "You cut that word in 2 drafts" },
  { id: "r3", kind: "ends_with", phrase: "Full notes in the newsletter, link in bio.", channels: ["instagram"], level: "warn", text: 'End with "Full notes in the newsletter, link in bio."', origin: "You added it to 2 drafts" },
  { id: "r4", kind: "replace", from: "open-source", to: "open-weights", channels: "all", level: "block", text: 'Say "open-weights", never "open-source", for a model.', origin: "You changed it in 4 drafts" },
];
