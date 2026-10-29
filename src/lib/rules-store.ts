/**
 * A person's playbook: the rules every draft is checked against before it reaches Buffer (src/lib/rules.ts).
 * The connector hands them to the AI (get_playbook) and save_drafts enforces them, so any AI follows the same rules.
 */
import { randomUUID } from "node:crypto";
import { and, asc, count, eq } from "drizzle-orm";
import { db } from "../db";
import { fixDismissed, rule as ruleTable } from "../db/schema";
import type { NewRule, Rule } from "./rules";

export const MAX_RULES = 50;

export class TooManyRulesError extends Error {
  constructor() {
    super(`A playbook holds up to ${MAX_RULES} rules. Delete one to add another.`);
  }
}

export type StoredRule = Rule & { fixes: number };

export type RulesStore = {
  list(userId: string): Promise<StoredRule[]>;
  /** Adds a rule and returns its id. */
  add(userId: string, rule: NewRule, fixes?: number): Promise<string>;
  remove(userId: string, id: string): Promise<void>;
  /** Remembers a repeated fix the person set aside with "Not now". */
  dismiss(userId: string, key: string): Promise<void>;
  dismissed(userId: string): Promise<Set<string>>;
};

/** Rules in Postgres through Drizzle; every statement is scoped to the user id. */
export function postgresRulesStore(): RulesStore {
  return {
    async list(userId) {
      const rows = await db().select().from(ruleTable).where(eq(ruleTable.userId, userId)).orderBy(asc(ruleTable.createdAt));
      return rows.map((r) => ({ ...(r.spec as NewRule), id: r.id, fixes: r.fixes }) as StoredRule);
    },
    async add(userId, spec, fixes = 0) {
      const [{ c }] = await db().select({ c: count() }).from(ruleTable).where(eq(ruleTable.userId, userId));
      if (c >= MAX_RULES) throw new TooManyRulesError();
      const id = randomUUID();
      await db().insert(ruleTable).values({ id, userId, spec, fixes });
      return id;
    },
    async remove(userId, id) {
      await db().delete(ruleTable).where(and(eq(ruleTable.userId, userId), eq(ruleTable.id, id)));
    },
    async dismiss(userId, key) {
      await db().insert(fixDismissed).values({ userId, key: key.slice(0, 500) }).onConflictDoNothing();
    },
    async dismissed(userId) {
      const rows = await db().select({ key: fixDismissed.key }).from(fixDismissed).where(eq(fixDismissed.userId, userId));
      return new Set(rows.map((r) => r.key));
    },
  };
}
