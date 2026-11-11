/**
 * @fileoverview The playbook as the connector reports it to an AI (get_playbook, get_setup_status). The starting rule
 * every account begins with is checked like any rule, but it is not the person's own, so an AI can still see that the
 * person has no rules of their own yet and offer to find their first ones.
 */
import { isStartingRule, ownRules, type AddedBy } from "./rule-origin";
import { ruleScope, type Rule } from "./rules";

/**
 * get_playbook's answer: one line per rule, with the starting rule marked, and a first line when the person has no rules
 * of their own.
 *
 * @param rules - The playbook as stored
 * @returns Plain text for the connector to return
 */
export function playbookAnswer(rules: Rule[]): string {
  if (!rules.length) return "No rules yet. Use add_rule when the user requests a rule, or list_rule_suggestions to learn from their edits.";
  const lines = rules.map((r) => `- ID ${r.id}: ${r.text} [${ruleScope(r)}; ${r.level === "block" ? "enforced: a draft that breaks it is not saved" : "checked: a draft that breaks it is saved and flagged"}${isStartingRule(r) ? "; starting rule from Queue Pilot, not one of the user's own" : ""}]`);
  const head = ownRules(rules).length ? [] : ["No rules of the user's own yet: only Queue Pilot's starting rule, which still applies. Use add_rule when the user requests a rule, or list_rule_suggestions to learn from their edits."];
  return [...head, ...lines].join("\n");
}

/** What get_setup_status reports about the playbook, beside the setup steps the screen shows. */
export type PlaybookSetup = {
  /** Rules the person kept, added or had their AI add; the starting rule is not counted. */
  ownRules: number;
  /** Whether Queue Pilot's starting rule is still in the playbook. */
  startingRule: boolean;
};

/**
 * The playbook facts for get_setup_status.
 *
 * @param rules - The playbook as stored, or null when it could not be read
 * @returns Own rule count and whether the starting rule is there, or null when the playbook could not be read
 */
export function playbookSetup(rules: { addedBy?: AddedBy }[] | null): PlaybookSetup | null {
  if (!rules) return null;
  return { ownRules: ownRules(rules).length, startingRule: rules.some(isStartingRule) };
}
