import { describe, expect, it } from "vitest";
import { describeRule, judgeDrafts, MIN_PROBABILITY, questionsFor, RULES_FIT, rulesFor, UNSURE_REASON } from "./judge";
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
    // A shared rule switched off for a network is never asked about there.
    expect(rulesFor([{ ...broth, channels: "all", except: ["instagram"] }], "instagram")).toEqual([]);
    expect(rulesFor([{ ...broth, channels: "all", except: ["instagram"] }], "linkedin").map((r) => r.id)).toEqual(["b1"]);
    const q = questionsFor([broth]);
    expect(Object.keys(q)).toEqual(["rule_b1"]);
    expect(Object.keys(q.rule_b1.criteria)).toEqual(["pass", "fail", "unsure"]);
    expect(describeRule(broth)).toContain("translations, other word forms");
    const opener: Rule = { id: "o", kind: "banned", phrases: ["Excited to share"], where: "start", channels: "all", level: "warn", text: "" };
    expect(describeRule(opener)).toMatch(/^Never open the post with "Excited to share".*Elsewhere in the post it is allowed\.$/);
  });
});

describe("replacement capitalization", () => {
  it("makes replacements conditional, and requires an ending only where the rule fits the post", () => {
    const replacement = questionsFor([broth]).rule_b1;
    expect(replacement.instructions).toContain("If the post does not refer to this subject, pass this rule");
    expect(replacement.instructions).toContain("translations, other word forms");
    const ending: Rule = { id: "end", kind: "ends_with", phrase: "Read the notes", channels: "all", level: "block", text: "End with Read the notes" };
    const required = questionsFor([ending]).rule_end;
    expect(required.instructions).toContain('The words to end with are "Read the notes"');
    expect(required.instructions).not.toContain("does not require the subject");
    expect(required.criteria.fail).toContain("lacks what the rule asks for where it fits this post");
    expect(required.criteria.pass).toContain("the rule does not fit this post");
  });

  it("allows capitalization variants for a wording change but preserves a case-only correction", () => {
    const abbreviation: Rule = { ...broth, from: "queue pilot", to: "qp", text: 'Say "qp", never "queue pilot".' };
    const question = questionsFor([abbreviation]).rule_b1.instructions;
    expect(question).toContain("Capitalization variants of the replacement are allowed");
    const capitalization: Rule = { ...broth, from: "openai", to: "OpenAI", text: 'Say "OpenAI", never "openai".' };
    expect(questionsFor([capitalization]).rule_b1.instructions).toContain("require the replacement’s exact capitalization");
    expect(questionsFor([capitalization]).rule_b1.instructions).not.toContain("variants of the replacement are allowed");
  });
});

describe("describeRule", () => {
  const ending = (text: string, phrase = "#ad"): Rule => ({ id: "e", kind: "ends_with", phrase, channels: "all", level: "block", text });

  it("leads with the person's sentence, so its scope is kept, then adds the exact words", () => {
    expect(describeRule(ending("End every post with: #ad"))).toBe('End every post with: #ad. The words to end with are "#ad", or the same line in the post\'s language.');
    expect(describeRule(ending('End every post with "#ad"'))).toMatch(/^End every post with "#ad"\. The words to end with are/);
    expect(describeRule(ending('End posts about qp with "#ad".'))).toMatch(/^End posts about qp with "#ad"\. The words to end with are/);
    const scoped = describeRule(ending('End posts about qp with "https://github.com/x/qp".', "https://github.com/x/qp"));
    expect(scoped.startsWith('End posts about qp with "https://github.com/x/qp".')).toBe(true);
    expect(scoped).toContain('The words to end with are "https://github.com/x/qp"');
  });

  it("keeps the hardened swap and ban wording after the person's sentence", () => {
    expect(describeRule(broth)).toMatch(/^Say "stock", never "broth"\. Say "stock", never "broth", when referring to this subject\..*If the post does not refer to this subject, pass this rule/);
    const ban: Rule = { id: "x", kind: "banned", phrases: ["game changer"], channels: "all", level: "block", text: "No hype in posts about launches" };
    expect(describeRule(ban)).toMatch(/^No hype in posts about launches\. Never use "game changer", nor a translation of it/);
  });

  it("gives a rule in the person's own words as written", () => {
    expect(describeRule(dish)).toBe(dish.text);
  });
});

describe("how rules fit a post", () => {
  it("says the fit principle once per question, in one wording that also keeps prohibitions", () => {
    const q = questionsFor([broth, dish]);
    for (const k of Object.keys(q)) expect(q[k as keyof typeof q].instructions.split(RULES_FIT)).toHaveLength(2);
    expect(RULES_FIT).toContain("A rule that forbids something always applies.");
  });

  it("asks the strict question for proving a habit: a post that lacks it has not followed it", () => {
    const strict = questionsFor([dish], true).rule_g1;
    expect(strict.instructions).not.toContain(RULES_FIT);
    expect(strict.criteria.pass).toBe("The post follows this rule.");
    expect(strict.criteria.fail).toContain("lacks what the rule asks for.");
    expect(strict.criteria.unsure).toContain("must still be present");
    expect(JSON.stringify(strict.criteria)).not.toContain("does not fit");
  });

  it("passes the strict question to the decision model when asked", async () => {
    const d = deciding(() => ({ rule_g1: choice("pass") }));
    await judgeDrafts({ decider: d.model, explainer: answering({}) }, [german], [dish], { strict: true });
    expect(JSON.stringify(d.calls[0])).toContain("The post follows this rule.");
    expect(JSON.stringify(d.calls[0])).not.toContain("does not fit");
  });

  it("words an unsure rule so the post can stay as it is", async () => {
    const d = deciding(() => ({ rule_g1: choice("unsure") }));
    const v = (await judgeDrafts({ decider: d.model, explainer: answering({}) }, [german], [dish])).get("s1")![0];
    expect(v).toMatchObject({ verdict: "unsure", reason: UNSURE_REASON });
    expect(UNSURE_REASON).toContain("If it does not fit, the post can stay as it is.");
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

