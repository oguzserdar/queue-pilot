import { describe, expect, it } from "vitest";
import { appliesTo, parseNewRule, ruleHold, ruleInput, ruleScope, type NewRule, type Rule } from "./rules";

// The example account's playbook.
const RULES: Rule[] = [
  { id: "r1", kind: "banned", phrases: ["Excited to share"], channels: ["linkedin"], level: "block", text: 'No "Excited to share". Start with the dish.' },
  { id: "r2", kind: "replace", from: "broth", to: "stock", channels: "all", level: "block", text: 'Say "stock", never "broth".' },
  { id: "r3", kind: "ends_with", phrase: "Recipe in the newsletter, link in bio.", channels: ["instagram"], level: "warn", text: 'End with "Recipe in the newsletter, link in bio."' },
  { id: "r4", kind: "guidance", channels: ["linkedin"], level: "warn", text: "Name the dish in the first line." },
];

describe("parseNewRule", () => {
  it("builds each kind of rule and writes its sentence", () => {
    expect(parseNewRule({ kind: "replace", from: "broth", to: "stock", channels: "all", level: "block" })).toMatchObject({ kind: "replace", text: 'Say "stock", never "broth".' });
    expect(parseNewRule({ kind: "banned", phrase: "Excited to share", channels: ["linkedin"], level: "block" })).toMatchObject({ kind: "banned", phrases: ["Excited to share"] });
    expect(parseNewRule({ kind: "guidance", text: "Name the dish first.", channels: "all", level: "block" })).toMatchObject({ kind: "guidance", level: "block" });
  });

  it("refuses unknown networks, missing words and unknown kinds with a sentence", () => {
    expect(parseNewRule({ kind: "banned", phrase: "x", channels: ["myspace"], level: "block" })).toMatch(/network/);
    expect(parseNewRule({ kind: "replace", from: "broth", to: " ", channels: "all" })).toMatch(/both/);
    expect(parseNewRule({ kind: "rm -rf", channels: "all" })).toMatch(/kind/);
    expect(parseNewRule(null)).toBe("Fill in the rule.");
  });

  it("caps the length of what a person can type", () => {
    expect(parseNewRule({ kind: "banned", phrase: "x".repeat(500), channels: "all" })).toMatch(/under/);
  });
});

describe("ruleHold", () => {
  it("names what happens to a draft that breaks each rule", () => {
    expect(RULES.map(ruleHold)).toEqual(["Blocks drafts", "Blocks drafts", "Flags drafts", "Flags drafts"]);
  });
});

describe("ruleInput", () => {
  const base = { channels: ["linkedin"], level: "warn" as const };
  const stored: NewRule[] = [
    { kind: "banned", phrases: ["Excited to share"], where: "start", text: 'Never start with "Excited to share".', ...base },
    { kind: "banned", phrases: ["synergy"], text: 'Never "synergy".', ...base },
    { kind: "replace", from: "broth", to: "stock", text: 'Say "stock", never "broth".', ...base },
    { kind: "ends_with", phrase: "Recipe in the newsletter", text: 'End with "Recipe in the newsletter"', ...base },
    { kind: "guidance", text: "Name the dish in the first line.", ...base },
  ];

  it.each(stored)("reads a stored $kind rule back as the same rule", (rule) => {
    expect(parseNewRule(ruleInput(rule))).toEqual(rule);
  });
});

describe("shared rules with channel exceptions", () => {
  const shared = { channels: "all" as const, except: ["linkedin"] };
  it("applies a shared rule everywhere except the networks it is switched off for", () => {
    expect(appliesTo(shared, "twitter")).toBe(true);
    expect(appliesTo(shared, "linkedin")).toBe(false);
    expect(appliesTo({ channels: ["linkedin"] }, "linkedin")).toBe(true);
    expect(appliesTo({ channels: ["linkedin"] }, "twitter")).toBe(false);
  });
  it("says where a rule applies in plain words", () => {
    expect(ruleScope({ channels: "all" })).toBe("every network");
    expect(ruleScope(shared)).toBe("every network except LinkedIn");
    expect(ruleScope({ channels: ["twitter", "linkedin"] })).toBe("X, LinkedIn");
  });
  it("keeps known exceptions on a shared rule and drops them anywhere else", () => {
    expect(parseNewRule({ kind: "guidance", text: "Short.", channels: "all", level: "warn", except: ["linkedin", "nope", "linkedin", 3] })).toMatchObject({ channels: "all", except: ["linkedin"] });
    expect(parseNewRule({ kind: "guidance", text: "Short.", channels: ["twitter"], level: "warn", except: ["linkedin"] })).not.toHaveProperty("except");
    expect(parseNewRule({ kind: "guidance", text: "Short.", channels: "all", level: "warn" })).not.toHaveProperty("except");
  });
});
