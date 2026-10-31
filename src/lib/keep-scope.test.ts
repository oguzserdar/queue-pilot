/**
 * @fileoverview Where a kept preference applies, and which rules an account's screens list.
 */
import { describe, expect, it } from "vitest";
import { atScope } from "./rule-suggestions";
import { rulesForAccount } from "./rule-explain";
import type { NewRule } from "./rules";

const fromReview = { key: "review:x", fixes: 0, rule: { kind: "guidance", text: "Say QP.", channels: "all", accountIds: ["company"], level: "warn" } as NewRule, evidence: { kind: "review", networks: ["linkedin"] } };

describe("atScope", () => {
  it("keeps a review preference for the reviewed accounts by default", () => {
    expect(atScope(fromReview)).toEqual(fromReview.rule);
    expect(atScope(fromReview, { level: "accounts" })).toEqual(fromReview.rule);
  });
  it("widens it to a reviewed network or to every account, dropping the account list", () => {
    expect(atScope(fromReview, { level: "network", network: "linkedin" })).toEqual({ kind: "guidance", text: "Say QP.", channels: ["linkedin"], level: "warn" });
    expect(atScope(fromReview, { level: "shared" })).toEqual({ kind: "guidance", text: "Say QP.", channels: "all", level: "warn" });
  });
  it("refuses a network the reviewed drafts were not on, and widening anything that is not review feedback", () => {
    expect(atScope(fromReview, { level: "network", network: "twitter" })).toBeNull();
    expect(atScope({ ...fromReview, evidence: { kind: "note" } }, { level: "shared" })).toBeNull();
  });
});

describe("rulesForAccount", () => {
  const rules = [
    { id: "s", text: "Shared", channels: "all" as const },
    { id: "off", text: "Shared but off here", channels: "all" as const, overrides: { accounts: { company: false } } },
    { id: "li", text: "LinkedIn", channels: ["linkedin"] },
    { id: "x", text: "X only", channels: ["twitter"] },
    { id: "mine", text: "Company only", channels: "all" as const, accountIds: ["company"] },
    { id: "theirs", text: "Personal only", channels: "all" as const, accountIds: ["personal"] },
  ];
  it("lists what applies first, then what is off here, and leaves out other accounts' and networks' rules", () => {
    const lines = rulesForAccount(rules, "linkedin", "company");
    expect(lines.map((l) => [l.rule.id, l.applies])).toEqual([["s", true], ["li", true], ["mine", true], ["off", false]]);
    expect(lines.find((l) => l.rule.id === "mine")).toMatchObject({ from: "This account's rule", why: "Written for this account" });
    expect(lines.find((l) => l.rule.id === "li")?.from).toBe("LinkedIn rule");
    expect(lines.find((l) => l.rule.id === "off")?.why).toBe("Off: excluded for this account");
  });
});
