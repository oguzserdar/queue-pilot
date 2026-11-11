import { expect, it } from "vitest";
import { DraftsSchema } from "./ai-writer";
import { evidenceInput, evidenceProblem } from "./source-evidence";
it("distinguishes a paraphrased draft claim from a fabricated source quote and timestamp", () => {
 const draft = "Seats cost $10.";
 expect(evidenceProblem(draft, draft, { claim: "Tickets are ten dollars", quote: draft })).toContain("exact draft");
 expect(evidenceProblem(draft, draft, { claim: draft, quote: "Free seats" })).toContain("not in the saved source");
 expect(evidenceProblem(draft, draft, { claim: draft, quote: draft, locator: "t=99" })).toContain("timestamp");
 expect(evidenceProblem(draft, draft, { claim: "Seats  cost $10.", quote: draft })).toBeNull();
});

it("reads an empty timestamp as no timestamp, so one draft without a video time does not void a whole answer", () => {
  const ev = { claim: "Low settings keep most of the score.", quote: "keep a majority of their performance", locator: "" };
  expect(evidenceInput.safeParse(ev).success).toBe(true);
  expect(DraftsSchema.safeParse({ drafts: [{ slotId: "a", text: "x", sourceKey: "k", evidence: [ev] }] }).success).toBe(true);
  expect(evidenceInput.safeParse({ ...ev, locator: "t=7190" }).success).toBe(true);
  expect(evidenceInput.safeParse({ ...ev, locator: "7190" }).success).toBe(false);
  expect(evidenceInput.safeParse({ ...ev, locator: "1:59:50" }).success).toBe(false);
});
