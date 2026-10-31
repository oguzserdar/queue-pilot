import { describe, expect, it } from "vitest";
import { resolveRule, type RuleRouting } from "./rule-scopes";
import { playbookVersion } from "./playbook-version";
import { parseNewRule, type Rule } from "./rules";
const shared: RuleRouting = { channels: "all" };
const company = "company";
const personal = "personal";
describe("shared, network and exact-account rules", () => {
  it("keeps legacy all, network lists and exclusions unchanged", () => {
    expect(resolveRule(shared, "linkedin", company).applies).toBe(true);
    expect(resolveRule({ channels: ["twitter"] }, "linkedin", company).applies).toBe(false);
    expect(resolveRule({ ...shared, except: ["linkedin"] }, "linkedin", company).applies).toBe(false);
  });
  it("never crosses company and personal profiles on the same network", () => {
    const rule = { ...shared, accountIds: [company], overrides: { accounts: { personal: true } } };
    expect(resolveRule(rule, "linkedin", company).applies).toBe(true);
    expect(resolveRule(rule, "linkedin", personal).applies).toBe(false);
    expect(resolveRule(rule, "linkedin").applies).toBe(false);
  });
  it("allows a personal include under a network exclusion", () => {
    const rule = { ...shared, overrides: { networks: { linkedin: false }, accounts: { personal: true } } };
    expect(resolveRule(rule, "linkedin", company).applies).toBe(false);
    expect(resolveRule(rule, "linkedin", personal).applies).toBe(true);
  });
  it("does not use an account include to import a different network's rule", () => {
    expect(resolveRule({ channels: ["twitter"], overrides: { accounts: { company: true } } }, "linkedin", company).applies).toBe(false);
  });
  it("independent accounts keep local rules and retain dormant exclusions", () => {
    const policy = { accounts: { company: { shared: false, network: false } } };
    const local = { channels: "all" as const, accountIds: [company], inheritance: policy };
    expect(resolveRule(local, "linkedin", company).applies).toBe(true);
    const inherited = { ...shared, overrides: { accounts: { company: true } }, inheritance: policy };
    expect(resolveRule(inherited, "linkedin", company).applies).toBe(false);
    expect(resolveRule({ ...inherited, inheritance: {} }, "linkedin", company).applies).toBe(true);
    expect(inherited.overrides.accounts.company).toBe(true);
  });
  it("network independence blocks shared rules but leaves network and account rules", () => {
    const inheritance = { networks: { linkedin: { shared: false } } };
    expect(resolveRule({ ...shared, inheritance }, "linkedin", personal).applies).toBe(false);
    expect(resolveRule({ channels: ["linkedin"], inheritance }, "linkedin", personal).applies).toBe(true);
  });
  it("keeps both contradictory contents active until an explicit exclusion", () => {
    const rules = [shared, { channels: ["linkedin"] }];
    expect(rules.filter(r => resolveRule(r, "linkedin", company).applies)).toHaveLength(2);
  });
  it("new inherited rules follow current settings, not an old copied list", () => {
    expect(resolveRule({ channels: "all", inheritance: { accounts: { company: { shared: false, network: true } } } }, "linkedin", company).applies).toBe(false);
  });
  it("parses account scope without widening it to all", () => {
    expect(parseNewRule({ kind: "guidance", text: "No emojis", channels: "all", accountIds: [company], level: "warn" })).toMatchObject({ accountIds: [company] });
    expect(typeof parseNewRule({ kind: "guidance", text: "No emojis", channels: "all", accountIds: [] })).toBe("string");
  });
  it("invalidates stored checks after an override, inheritance or rule change", () => {
    const r: Rule = { id: "r", kind: "guidance", text: "No emojis", channels: "all", level: "block" };
    const version = playbookVersion([r]);
    expect(playbookVersion([{ ...r, overrides: { accounts: { company: false } } }])).not.toBe(version);
    expect(playbookVersion([{ ...r, inheritance: { networks: { linkedin: { shared: false } } } }])).not.toBe(version);
    expect(playbookVersion([{ ...r, learnedFrom: { private: "note" } }])).toBe(version);
  });
});
