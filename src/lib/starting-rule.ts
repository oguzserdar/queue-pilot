/**
 * @fileoverview The one rule every new account starts with, so private matters are kept out of public posts from day
 * one, whichever AI writes the drafts. It is judged by meaning like any rule in the person's own words, flags a draft
 * and never blocks it, and the person owns it: they can remove it or switch it off for an account like any other rule.
 *
 * It is added once, when Better Auth creates the user (src/lib/auth.ts). A marker kept with the account's set-aside keys
 * records that it was given, so a person who removes it never gets it back, even if seeding runs again.
 */
import { randomUUID } from "node:crypto";
import { db } from "../db";
import { fixDismissed, rule as ruleTable } from "../db/schema";
import type { NewRule } from "./rules";

/** The starting rule as stored: in the person's own words, on every network, flagging a draft that breaks it. */
export const STARTING_RULE: NewRule = Object.freeze({
  kind: "guidance" as const,
  text: "Keep private matters private: nothing about my own or anyone's health, legal or immigration case, money, family, relationships, or an employee's or customer's situation, unless already public.",
  channels: "all" as const,
  level: "warn" as const,
  addedBy: "starting" as const,
});

/** The key that records the starting rule was given, stored with the account's set-aside keys (qp_fix_dismissed). */
export const STARTING_RULE_KEY = "starting-rule:private-matters";

/**
 * Gives an account the starting rule, once. The marker and the rule are written in one transaction, so either both
 * exist or neither does; a second call finds the marker and adds nothing, even after the person removed the rule.
 *
 * @param userId - The account's user id
 * @returns True when the rule was added now, false when the account already had it once
 */
export async function seedStartingRule(userId: string): Promise<boolean> {
  return db().transaction(async (tx) => {
    const marked = await tx.insert(fixDismissed).values({ userId, key: STARTING_RULE_KEY }).onConflictDoNothing().returning({ key: fixDismissed.key });
    if (!marked.length) return false;
    await tx.insert(ruleTable).values({ id: randomUUID(), userId, spec: STARTING_RULE });
    return true;
  });
}

/**
 * The account-creation step: seeds the starting rule and never fails sign-in. A failure is logged and the account
 * simply starts without the rule.
 *
 * @param userId - The new account's user id
 */
export async function seedStartingRuleSafely(userId: string): Promise<void> {
  try {
    await seedStartingRule(userId);
  } catch (e) {
    console.error(JSON.stringify({ event: "qp-starting-rule-failed", message: e instanceof Error ? e.message : String(e) }));
  }
}
