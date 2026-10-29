import { describe, expect, it } from "vitest";
import { describeRule, judgeDrafts, MIN_PROBABILITY, questionsFor, rulesFor } from "./judge";
import { answering, deciding } from "./ai-test-model";
import type { Rule } from "./rules";

const dish: Rule = { id: "g1", kind: "guidance", channels: ["linkedin"], level: "warn", text: "Name the dish in the first line." };
const broth: Rule = { id: "b1", kind: "replace", from: "broth", to: "stock", channels: "all", level: "block", text: 'Say "stock", never "broth".' };
/** A choice answer; with p, a complete distribution over pass/fail/unsure as providers return it. */
const choice = (c: string, p?: number) => {
  if (p === undefined) return { type: "choice" as const, choice: c };
  const others = ["pass", "fail", "unsure"].filter((x) => x !== c);
  return { type: "choice" as const, choice: c, probabilities: { [c]: p, [others[0]]: (1 - p) / 2, [others[1]]: (1 - p) / 2 } };
};
const german = { slotId: "s1", network: "linkedin", text: "Eine gute Brühe beginnt kalt. Weiße-Bohnen-Suppe." };

describe("rules as decision questions", () => {
  it("asks one pass/fail/unsure choice per rule that applies on the network, by meaning", () => {
    expect(rulesFor([dish, broth], "instagram").map((r) => r.id)).toEqual(["b1"]);
    const q = questionsFor([broth]);
    expect(Object.keys(q)).toEqual(["rule_b1"]);
    expect(Object.keys(q.rule_b1.criteria)).toEqual(["pass", "fail", "unsure"]);
    expect(describeRule(broth)).toContain("translations, other word forms");
    const opener: Rule = { id: "o", kind: "banned", phrases: ["Excited to share"], where: "start", channels: "all", level: "warn", text: "" };
    expect(describeRule(opener)).toMatch(/^Never open the post with "Excited to share".*Elsewhere in the post it is allowed\.$/);
  });
});

describe("judgeDrafts", () => {
  it("fails a German draft on the broth rule and quotes the German word", async () => {
    const d = deciding(() => ({ rule_b1: choice("fail", 0.97), rule_g1: choice("pass", 0.9) }));
    const explainer = answering({ quote: "Brühe", reason: "Brühe is broth in German." });
    const v = (await judgeDrafts({ decider: d.model, explainer }, [german], [dish, broth])).get("s1")!;
    expect(v.find((x) => x.ruleId === "b1")).toMatchObject({ verdict: "fail", probability: 0.97, quote: "Brühe", level: "block" });
    expect(v.find((x) => x.ruleId === "g1")).toMatchObject({ verdict: "pass" });
    expect(d.calls[0].state).toEqual([{ type: "text", text: `Network: linkedin\n\n${german.text}` }]);
  });

  it(`counts an answer below ${MIN_PROBABILITY} probability as unsure`, async () => {
    const d = deciding(() => ({ rule_b1: choice("fail", 0.55) }));
    const v = (await judgeDrafts({ decider: d.model, explainer: answering({ quote: "Brühe", reason: "r" }) }, [german], [broth])).get("s1")!;
    expect(v[0]).toMatchObject({ verdict: "unsure", probability: 0.55 });
  });

  it("takes a choice without probabilities (as Anthropic answers) as given", async () => {
    const d = deciding(() => ({ rule_b1: choice("pass") }));
    expect((await judgeDrafts({ decider: d.model, explainer: answering({}) }, [german], [broth])).get("s1")![0]).toMatchObject({ verdict: "pass", probability: null });
  });

  it("turns a do-not-save fail into unsure when no real words of the draft can be quoted", async () => {
    const d = deciding(() => ({ rule_b1: choice("fail", 0.95) }));
    const explainer = answering({ quote: "broth", reason: "Mentions broth." });
    expect((await judgeDrafts({ decider: d.model, explainer }, [german], [broth])).get("s1")![0].verdict).toBe("unsure");
  });

  it("throws when the decision call fails, so the drafts are reported as not checked", async () => {
    const failing = { ...deciding(() => ({})).model, doDecide: async () => { throw new Error("401"); } };
    await expect(judgeDrafts({ decider: failing, explainer: answering({}) }, [german], [broth])).rejects.toThrow();
  });

  it("makes no call when no rule applies on the network", async () => {
    const d = deciding(() => ({}));
    expect((await judgeDrafts({ decider: d.model, explainer: answering({}) }, [{ ...german, network: "x" }], [dish])).size).toBe(0);
    expect(d.calls).toHaveLength(0);
  });
});

describe("judgeDrafts without a decision model (OpenRouter)", () => {
  it("asks the language model for one verdict per rule, then quotes the failing words", async () => {
    const explainer = answering(
      { verdicts: [{ rule: "rule_b1", choice: "fail" }] },
      { quote: "Brühe", reason: "Brühe is broth in German." },
    );
    const v = await judgeDrafts({ decider: null, explainer }, [german], [broth]);
    expect(v.get("s1")).toMatchObject([{ ruleId: "b1", verdict: "fail", probability: null, quote: "Brühe" }]);
  });
  it("counts a rule the model did not answer as unsure, never as passed", async () => {
    const explainer = answering({ verdicts: [] });
    const v = await judgeDrafts({ decider: null, explainer }, [german], [broth]);
    expect(v.get("s1")).toMatchObject([{ ruleId: "b1", verdict: "unsure" }]);
  });
});

