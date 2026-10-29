/**
 * The example account's playbook, shared by the Playbook screen and the week view so both check drafts against the
 * same rules. Mark Evans writes Weeknight Dinners; these are fixes he made more than once.
 */
import type { Rule } from "./rules";

export type ExampleRule = Rule & { origin: string };

export const EXAMPLE_RULES: ExampleRule[] = [
  { id: "r1", kind: "guidance", channels: ["linkedin"], level: "warn", text: "Name the dish in the first line.", origin: "You moved the dish to the front in 3 drafts" },
  { id: "r2", kind: "banned", phrases: ["Excited to share"], channels: ["linkedin"], level: "block", text: 'No "Excited to share". Start with the dish.', origin: "You cut that opening in 2 drafts" },
  { id: "r3", kind: "ends_with", phrase: "Recipe in the newsletter, link in bio.", channels: ["instagram"], level: "warn", text: 'End with "Recipe in the newsletter, link in bio."', origin: "You added it to 2 drafts" },
  { id: "r4", kind: "replace", from: "broth", to: "stock", channels: "all", level: "block", text: 'Say "stock", never "broth".', origin: "You changed it in 4 drafts" },
];
