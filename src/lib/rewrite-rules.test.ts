import { describe, expect, it } from "vitest";
import { buildRewritePrompt, proposeRules, rewritesIn, supported } from "./rewrite-rules";
import { answering, sentText } from "./ai-test-model";
import type { Edit } from "./fixes";

const ig = (before: string, after: string, id: string): Edit => ({ postId: id, network: "instagram", before, after });
const r1 = ig("The soup I make on repeat, with white beans and kale.", "White bean and kale soup. I make it every cold night.", "p1");
const r2 = ig("A feeling of comfort in a bowl tonight: mushroom risotto.", "Mushroom risotto, the slow way, for a quiet night in.", "p2");
const small = ig("A good broth starts cold.", "A good stock starts cold.", "p3");

describe("rewritesIn", () => {
  it("sends every real edit to the model, one-word fixes included, so rules come from inference, not text matching", () => {
    const same = ig("Left as written.", "Left as written.", "p4");
    expect(rewritesIn([r1, r2, small, same]).map((e) => e.postId)).toEqual(["p1", "p2", "p3"]);
  });
});

describe("grouping by meaning", () => {
  it("tells the model that differently worded edits with one meaning are the same change", () => {
    const { system } = buildRewritePrompt([r1, r2], []);
    expect(system).toMatch(/not by the exact words/);
  });

  it("keeps a rule the model draws from two edits that share a meaning but no words", () => {
    const e1 = ig("Excited to share our new soup.", "Our new soup.", "e1");
    const e2 = ig("Thrilled to announce the risotto.", "The risotto.", "e2");
    const [p] = supported([{ rule: "Never open with excitement about sharing.", evidence: [1, 2] }], rewritesIn([e1, e2]));
    expect(p.evidence.map((e) => e.postId)).toEqual(["e1", "e2"]);
  });
});

describe("supported", () => {
  it("keeps a proposal that cites two real rewrites, on the network they share", () => {
    const [p] = supported([{ rule: "Start with the dish, not a feeling.", evidence: [1, 2] }], [r1, r2]);
    expect(p.rule).toMatchObject({ kind: "guidance", text: "Start with the dish, not a feeling.", channels: ["instagram"], level: "warn" });
    expect(p.evidence.map((e) => e.postId)).toEqual(["p1", "p2"]);
  });

  it("drops a proposal with one rewrite, repeated citations, or numbers that do not exist", () => {
    expect(supported([{ rule: "A", evidence: [1] }, { rule: "B", evidence: [2, 2] }, { rule: "C", evidence: [1, 9] }], [r1, r2])).toEqual([]);
  });

  it("applies to every network when the rewrites span several", () => {
    const li = { ...r2, network: "linkedin" };
    expect(supported([{ rule: "Start with the dish.", evidence: [1, 2] }], [r1, li])[0].rule.channels).toBe("all");
  });
});

describe("proposeRules", () => {
  it("asks the model with the rewrites fenced as data, and returns only supported proposals", async () => {
    const m = answering({ rules: [{ rule: "Start with the dish, not a feeling.", evidence: [1, 2] }, { rule: "One-off", evidence: [2] }] });
    const out = await proposeRules(m, [r1, r2], []);
    expect(out.map((p) => p.rule.text)).toEqual(["Start with the dish, not a feeling."]);
    expect(sentText(m)).toContain("Edit 2 (instagram)");
  });

  it("makes no call with fewer than two rewrites", async () => {
    const m = answering({ rules: [] });
    expect(await proposeRules(m, [r1], [])).toEqual([]);
    expect(m.doGenerateCalls).toHaveLength(0);
  });

  it("lists existing rules so the model does not repeat them", () => {
    expect(buildRewritePrompt([r1, r2], [{ id: "x", kind: "guidance", channels: "all", level: "warn", text: "Keep it short." }]).prompt).toContain("- Keep it short.");
  });
});
