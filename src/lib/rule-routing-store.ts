/** Owner-checked routing changes. No assistant can turn off ownership or publishing safeguards. */
import { and, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { rule as ruleTable, ruleInheritance } from "../db/schema";
import { postgresSnapshotStore } from "./buffer/snapshot-store";
import { NETWORKS, type NewRule } from "./rules";
import type { Inheritance } from "./rule-scopes";

export type RuleTarget = { level: "network" | "account"; id: string };
export async function ownedAccounts(userId: string, ids: string[]) {
  const snapshot = await postgresSnapshotStore().get(userId);
  return ids.length > 0 && ids.every(id => snapshot?.data.channels.some(c => c.id === id));
}
async function validTarget(userId: string, target: RuleTarget) {
  if (!target || typeof target.id !== "string" || target.id.length > 200) return false;
  return target.level === "network" ? Object.hasOwn(NETWORKS, target.id) : target.level === "account" && await ownedAccounts(userId, [target.id]);
}
export async function setRuleOverride(userId: string, ruleId: string, target: RuleTarget, value: boolean | null): Promise<boolean> {
  if (typeof ruleId !== "string" || ruleId.length > 200 || ![true, false, null].includes(value) || !(await validTarget(userId, target))) return false;
  return db().transaction(async tx => {
    const [row] = await tx.select().from(ruleTable).where(and(eq(ruleTable.userId, userId), eq(ruleTable.id, ruleId))).for("update");
    if (!row) return false;
    const spec = row.spec as NewRule;
    // An account rule never flows to another account, even through an explicit include.
    if (spec.accountIds?.length || (target.level === "network" && spec.channels !== "all")) return false;
    if (target.level === "account" && spec.channels !== "all") {
      const snap = await postgresSnapshotStore().get(userId);
      const channel = snap?.data.channels.find(c => c.id === target.id);
      if (!channel || !spec.channels.includes(channel.service)) return false;
    }
    const key = target.level === "network" ? "networks" : "accounts";
    const next = { ...spec, overrides: { ...spec.overrides, [key]: { ...spec.overrides?.[key] } } };
    if (value === null) delete next.overrides[key]![target.id];
    else next.overrides[key]![target.id] = value;
    // A reset removes a legacy exclusion too; an explicit include can override it.
    if (target.level === "network" && value === null) next.except = next.except?.filter(n => n !== target.id);
    await tx.update(ruleTable).set({ spec: next }).where(and(eq(ruleTable.userId, userId), eq(ruleTable.id, ruleId)));
    return true;
  });
}
export async function readInheritance(userId: string): Promise<Inheritance> {
  const [row] = await db().select().from(ruleInheritance).where(eq(ruleInheritance.userId, userId));
  return (row?.settings ?? {}) as Inheritance;
}
export async function setInheritance(userId: string, target: RuleTarget, shared: boolean, network: boolean): Promise<boolean> {
  if (typeof shared !== "boolean" || typeof network !== "boolean" || !(await validTarget(userId, target))) return false;
  // jsonb_set on a top-level map preserves simultaneous changes to other accounts.
  const group = target.level === "network" ? "networks" : "accounts";
  const value = target.level === "network" ? { shared } : { shared, network };
  const patch = { [target.id]: value };
  await db().insert(ruleInheritance).values({ userId, settings: { [group]: patch } }).onConflictDoUpdate({
    target: ruleInheritance.userId,
    set: { settings: sql`jsonb_set(${ruleInheritance.settings}, array[${group}], coalesce(${ruleInheritance.settings}->${group}, '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb)` },
  });
  return true;
}
