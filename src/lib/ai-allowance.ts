/**
 * The built-in AI allowance: people without their own key use Queue Pilot's key, up to a number of AI actions per
 * person per UTC day and a total per day across everyone. One action is one thing the person asked for (write a week,
 * check a draft, read rewrites), whatever number of model calls it takes. The operator sets both caps in /admin.
 *
 * Taking an action is one transaction of two conditional increments, so two requests at the same moment cannot both
 * pass the last free slot, and a refused action counts against neither cap. An action whose AI call fails is given
 * back.
 */
import { and, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { aiUsage, aiUsageTotal } from "../db/schema";

/** Daily action caps: per person and across everyone. */
export type Caps = { perPerson: number; total: number };
/** No daily ceiling on everyone together: the dollar budget is the real limit (src/lib/settings.ts, ai_cap_total). */
export const NO_DAILY_TOTAL = 2_000_000_000;

/** "ok", or which cap stopped the action. */
export type Taken = "ok" | "person" | "total";

/** Where built-in AI use is counted, per person, per day and in dollars. */
export type AllowanceStore = {
  take(userId: string, day: string, caps: Caps): Promise<Taken>;
  used(userId: string, day: string): Promise<{ mine: number; total: number }>;
  /** Returns one action after the AI call it paid for failed, so a provider error never costs the person. Never below zero. */
  giveBack(userId: string, day: string): Promise<void>;
  /** Adds what an action cost, in millionths of a dollar, to the person's day and the day's total. */
  addCost(userId: string, day: string, micros: number): Promise<void>;
  /** Everything spent on the built-in key so far, in millionths of a dollar: the number the budget is checked against. */
  spentMicros(): Promise<number>;
};

/** The UTC day an action counts against, as YYYY-MM-DD. */
export const utcDay = (now: Date) => now.toISOString().slice(0, 10);

class CapReached extends Error {
  constructor(readonly which: Exclude<Taken, "ok">) { super(which); }
}

/** The allowance counters in Postgres. */
export function postgresAllowanceStore(): AllowanceStore {
  return {
    async take(userId, day, caps) {
      try {
        await db().transaction(async (tx) => {
          const total = await tx.insert(aiUsageTotal).values({ day, actions: 1 })
            .onConflictDoUpdate({ target: aiUsageTotal.day, set: { actions: sql`${aiUsageTotal.actions} + 1` }, setWhere: sql`${aiUsageTotal.actions} < ${caps.total}` })
            .returning({ actions: aiUsageTotal.actions });
          if (!total.length || caps.total < 1) throw new CapReached("total");
          const mine = await tx.insert(aiUsage).values({ userId, day, actions: 1 })
            .onConflictDoUpdate({ target: [aiUsage.userId, aiUsage.day], set: { actions: sql`${aiUsage.actions} + 1` }, setWhere: sql`${aiUsage.actions} < ${caps.perPerson}` })
            .returning({ actions: aiUsage.actions });
          if (!mine.length || caps.perPerson < 1) throw new CapReached("person");
        });
        return "ok";
      } catch (e) {
        if (e instanceof CapReached) return e.which;
        throw e;
      }
    },
    async giveBack(userId, day) {
      await db().transaction(async (tx) => {
        await tx.update(aiUsage).set({ actions: sql`greatest(${aiUsage.actions} - 1, 0)` }).where(and(eq(aiUsage.userId, userId), eq(aiUsage.day, day)));
        await tx.update(aiUsageTotal).set({ actions: sql`greatest(${aiUsageTotal.actions} - 1, 0)` }).where(eq(aiUsageTotal.day, day));
      });
    },
    async addCost(userId, day, micros) {
      if (micros <= 0) return;
      await db().transaction(async (tx) => {
        await tx.insert(aiUsage).values({ userId, day, actions: 0, costMicros: micros })
          .onConflictDoUpdate({ target: [aiUsage.userId, aiUsage.day], set: { costMicros: sql`${aiUsage.costMicros} + ${micros}` } });
        await tx.insert(aiUsageTotal).values({ day, actions: 0, costMicros: micros })
          .onConflictDoUpdate({ target: aiUsageTotal.day, set: { costMicros: sql`${aiUsageTotal.costMicros} + ${micros}` } });
      });
    },
    async spentMicros() {
      const [row] = await db().select({ total: sql<string>`coalesce(sum(${aiUsageTotal.costMicros}), 0)` }).from(aiUsageTotal);
      return Number(row?.total ?? 0);
    },
    async used(userId, day) {
      const [[mine], [total]] = await Promise.all([
        db().select({ actions: aiUsage.actions }).from(aiUsage).where(and(eq(aiUsage.userId, userId), eq(aiUsage.day, day))),
        db().select({ actions: aiUsageTotal.actions }).from(aiUsageTotal).where(eq(aiUsageTotal.day, day)),
      ]);
      return { mine: mine?.actions ?? 0, total: total?.actions ?? 0 };
    },
  };
}

/** What the person sees when a cap stops them. */
export function capMessage(which: Exclude<Taken, "ok">, caps: Caps): string {
  return which === "person"
    ? `You have used today's ${caps.perPerson} AI actions on Queue Pilot's key. It resets at midnight UTC, or add your own key in Settings for no limit.`
    : "Queue Pilot's shared AI key is used up for today. It resets at midnight UTC, or add your own key in Settings.";
}
