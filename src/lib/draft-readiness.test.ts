/**
 * @fileoverview draftReadiness and approvable: which drafts may be approved from their last playbook check.
 */
import { describe, expect, it } from "vitest";
import { approvable, draftReadiness } from "./draft-readiness";
import type { Verdict } from "./judge";
import { playbookVersion } from "./playbook-version";
import type { Rule } from "./rules";
import type { Written } from "./written-store";

const warn: Rule = { id: "w", kind: "guidance", text: "Make one point.", channels: "all", level: "warn" } as Rule;
const block: Rule = { id: "b", kind: "guidance", text: "Never say broth.", channels: "all", level: "block" } as Rule;
const rules = [warn, block];
const v = (rule: Rule, verdict: Verdict["verdict"], extra: Partial<Verdict> = {}): Verdict => ({ ruleId: rule.id, rule: rule.text, level: rule.level, verdict, probability: null, quote: "", reason: "", ...extra });
const w = (verdicts: Verdict[] | null, text = "Soup tonight.", revision = playbookVersion(rules)): Written => ({ postId: "p", network: "linkedin", text, verdicts, playbookRevision: revision });

describe("draftReadiness", () => {
  it("is ready when every rule passed on the current text and rules", () => {
    expect(draftReadiness(w([v(warn, "pass"), v(block, "pass")]), "Soup tonight.", rules).state).toBe("ok");
  });
  it("only flags a failed warning rule", () => {
    expect(draftReadiness(w([v(warn, "fail"), v(block, "pass")]), "Soup tonight.", rules).state).toBe("flagged");
  });
  it("breaks on a failed blocking rule", () => {
    expect(draftReadiness(w([v(warn, "pass"), v(block, "fail")]), "Soup tonight.", rules).state).toBe("breaks");
  });
  it("needs a look, not a pass, when a blocking rule is unsure or had no answer", () => {
    const unsure = draftReadiness(w([v(warn, "pass"), v(block, "unsure")]), "Soup tonight.", rules);
    const missing = draftReadiness(w([v(warn, "pass"), v(block, "unsure", { unavailable: true })]), "Soup tonight.", rules);
    expect([unsure.state, unsure.stale, missing.state]).toEqual(["check", undefined, "check"]);
  });
  it("needs a fresh check when the text, the rules or the check itself is missing or out of date", () => {
    expect(draftReadiness(w([v(block, "pass")]), "Edited soup.", rules)).toMatchObject({ state: "check", stale: true });
    expect(draftReadiness(w([v(block, "pass")], "Soup tonight.", "old"), "Soup tonight.", rules)).toMatchObject({ state: "check", stale: true });
    expect(draftReadiness(w(null), "Soup tonight.", rules)).toMatchObject({ state: "check", stale: true });
  });
  it("lets an unchecked draft go out flagged when no rule blocks", () => {
    expect(draftReadiness(w(null, "Soup tonight.", "old"), "Soup tonight.", [warn]).state).toBe("flagged");
  });
});

describe("approvable", () => {
  it("refuses breaking and stale drafts with their reason and leaves the rest", () => {
    const written = [{ ...w([v(block, "fail")]), postId: "bad" }, { ...w([v(block, "pass")]), postId: "stale" }, { ...w([v(block, "pass")]), postId: "fine" }];
    const posts = [{ id: "bad", text: "Soup tonight." }, { id: "stale", text: "Edited." }, { id: "fine", text: "Soup tonight." }];
    const r = approvable(["bad", "stale", "fine", "not-ours"], written, posts, rules);
    expect(r.allowed).toEqual(["fine", "not-ours"]);
    expect(r.refused.map((x) => x.id)).toEqual(["bad", "stale"]);
  });
});
