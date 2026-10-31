/**
 * A person's playbook: the rules every draft is checked against before it reaches Buffer (src/lib/rules.ts).
 * The connector hands them to the AI (get_playbook) and save_drafts enforces them, so any AI follows the same rules.
 */
import { ownedAccounts } from "./rule-routing-store";
import { randomUUID } from "node:crypto";
import { and, asc, count, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { fixDismissed, rule as ruleTable, ruleInheritance } from "../db/schema";
import type { Inheritance } from "./rule-scopes";
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
  /** Switches a shared rule off or back on for one network. A rule for named networks is left alone. */
  setException(userId: string, id: string, network: string, off: boolean): Promise<boolean>;
  /** Remembers a repeated fix the person set aside with "Not now". */
  dismiss(userId: string, key: string): Promise<void>;
  dismissed(userId: string): Promise<Set<string>>;
};

/** Rules in Postgres through Drizzle; every statement is scoped to the user id. */
export function postgresRulesStore(): RulesStore {
  return {
    async list(userId) {
      const rows = await db().select().from(ruleTable).where(eq(ruleTable.userId, userId)).orderBy(asc(ruleTable.createdAt));
      const [policy] = await db().select().from(ruleInheritance).where(eq(ruleInheritance.userId, userId));
      const inheritance = (policy?.settings ?? {}) as Inheritance;
      return rows.map((r) => ({ ...(r.spec as NewRule), id: r.id, fixes: r.fixes, ...(Object.keys(inheritance).length ? { inheritance } : {}) }) as StoredRule);
    },
    async add(userId, spec, fixes = 0) {
      if (spec.accountIds && !(await ownedAccounts(userId, spec.accountIds))) throw new Error("Choose an account connected to your Queue Pilot.");
      const overrides = Object.keys(spec.overrides?.accounts ?? {});
      if (overrides.length && !(await ownedAccounts(userId, overrides))) throw new Error("Choose an account connected to your Queue Pilot.");
      const { inheritance: _runtime, ...persisted } = spec;
      spec = persisted as NewRule;
      const [{ c }] = await db().select({ c: count() }).from(ruleTable).where(eq(ruleTable.userId, userId));
      if (c >= MAX_RULES) throw new TooManyRulesError();
      const id = randomUUID();
      await db().insert(ruleTable).values({ id, userId, spec, fixes });
      return id;
    },
    async remove(userId, id) {
      await db().delete(ruleTable).where(and(eq(ruleTable.userId, userId), eq(ruleTable.id, id)));
    },
    async setException(userId, id, network, off) {
      // One statement on the stored rule, so two quick toggles cannot overwrite each other's network.
      const r = await db().execute(sql`
        update ${ruleTable} set spec = jsonb_set(spec #- array['overrides','networks',${network}], '{except}', coalesce((
          select jsonb_agg(distinct n order by n) from (
            select jsonb_array_elements_text(coalesce(spec->'except', '[]'::jsonb)) as n
            union all select ${network} where ${off}
          ) s where ${off} or n <> ${network}
        ), '[]'::jsonb))
        where id = ${id} and user_id = ${userId} and spec->>'channels' = 'all'
        returning id`);
      return (r as unknown as { rows: unknown[] }).rows.length > 0;
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
