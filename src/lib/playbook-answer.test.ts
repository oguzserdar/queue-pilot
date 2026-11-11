/**
 * @fileoverview What the connector tells an AI about the playbook: the starting rule is listed and still applies, but an
 * AI can see the person has no rules of their own yet; an empty playbook still says "No rules yet".
 */
import { describe, expect, it } from "vitest";
import { playbookAnswer, playbookSetup } from "./playbook-answer";
import type { Rule } from "./rules";

const starting = { id: "s", kind: "guidance", text: "Keep private matters private.", channels: "all", level: "warn", addedBy: "starting" } as Rule;
const mine = { id: "m", kind: "guidance", text: "Name the number first.", channels: ["linkedin"], level: "block", addedBy: "you" } as Rule;

describe("playbookAnswer", () => {
  it("says there are no rules when the playbook is empty", () => {
    expect(playbookAnswer([])).toMatch(/^No rules yet\./);
  });

  it("lists the starting rule and says the person has no rules of their own yet", () => {
    const text = playbookAnswer([starting]);
    expect(text.split("\n")[0]).toContain("No rules of the user's own yet");
    expect(text).toContain("ID s: Keep private matters private.");
    expect(text).toContain("starting rule from Queue Pilot");
    expect(text).toContain("checked: a draft that breaks it is saved and flagged");
  });

  it("drops the no-own-rules line once the person has a rule, and still marks the starting rule", () => {
    const text = playbookAnswer([starting, mine]);
    expect(text).not.toContain("No rules of the user's own yet");
    expect(text.split("\n")).toHaveLength(2);
    expect(text).toContain("ID m: Name the number first. [LinkedIn; enforced");
    expect(text).toContain("ID s: Keep private matters private. [every network; checked: a draft that breaks it is saved and flagged; starting rule");
  });
});

describe("playbookSetup", () => {
  it("counts only the person's own rules", () => {
    expect(playbookSetup([starting])).toEqual({ ownRules: 0, startingRule: true });
    expect(playbookSetup([starting, mine])).toEqual({ ownRules: 1, startingRule: true });
    expect(playbookSetup([mine])).toEqual({ ownRules: 1, startingRule: false });
    expect(playbookSetup([])).toEqual({ ownRules: 0, startingRule: false });
  });

  it("reports nothing when the playbook could not be read", () => {
    expect(playbookSetup(null)).toBeNull();
  });
});
