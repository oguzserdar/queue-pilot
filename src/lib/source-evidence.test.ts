import { expect, it } from "vitest";
import { evidenceProblem } from "./source-evidence";
it("distinguishes a paraphrased draft claim from a fabricated source quote and timestamp", () => {
 const draft = "Seats cost $10.";
 expect(evidenceProblem(draft, draft, { claim: "Tickets are ten dollars", quote: draft })).toContain("exact draft");
 expect(evidenceProblem(draft, draft, { claim: draft, quote: "Free seats" })).toContain("not in the saved source");
 expect(evidenceProblem(draft, draft, { claim: draft, quote: draft, locator: "t=99" })).toContain("timestamp");
 expect(evidenceProblem(draft, draft, { claim: "Seats  cost $10.", quote: draft })).toBeNull();
});
