/**
 * @fileoverview The starting rule every new account gets: exactly one rule that keeps private matters out of posts, in
 * the person's own words, flagging (never blocking) on every network. It is given once: seeding again adds nothing, a
 * removed rule never comes back, a failure never stops sign-in, and it is exported and deleted like any rule.
 */
import { migratedPglite } from "@/test/migrated-pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// Real Postgres (PGLite) with the real migrations, behind the app's Drizzle client.
const pg = await migratedPglite();
const testDb = drizzle(pg, { schema: { ...(await import("../db/schema")), ...(await import("../db/auth-schema")) } });
vi.mock("../db", () => ({ db: () => testDb, schema: {} }));

const { seedStartingRule, seedStartingRuleSafely } = await import("./starting-rule");
const { postgresRulesStore } = await import("./rules-store");
const { parseNewRule } = await import("./rules");
const { ruleOrigin } = await import("./rule-origin");
const { exportUserData } = await import("./export-data");
const { deleteAccount } = await import("./delete-account");

const TEXT = "Keep private matters private: nothing about my own or anyone's health, legal or immigration case, money, family, relationships, or an employee's or customer's situation, unless already public.";

beforeEach(async () => {
  await pg.query(`delete from "user"`);
  await pg.query(`insert into "user" (id, name, email, role) values ('new', 'n', 'n@x', 'user'), ('other', 'o', 'o@x', 'admin')`);
});
afterAll(async () => { await pg.close(); });

describe("the starting rule", () => {
  it("gives a new account exactly this rule, flagging drafts on every network, judged by meaning", async () => {
    await seedStartingRule("new");
    const rules = await postgresRulesStore().list("new");
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({ kind: "guidance", text: TEXT, channels: "all", level: "warn" });
    expect(rules[0].except ?? []).toEqual([]);
    expect(rules[0].accountIds).toBeUndefined();
    expect(ruleOrigin(rules[0])).toBe("Starting rule");
    expect(await postgresRulesStore().list("other")).toHaveLength(0);
  });

  it("is a rule the rule field accepts as written", () => {
    expect(TEXT.length).toBeLessThanOrEqual(200);
    expect(parseNewRule({ kind: "guidance", text: TEXT, channels: "all", level: "warn" })).toMatchObject({ kind: "guidance", text: TEXT });
  });

  it("is not added twice when the account is created or signs in again", async () => {
    expect(await seedStartingRule("new")).toBe(true);
    expect(await seedStartingRule("new")).toBe(false);
    await seedStartingRuleSafely("new");
    expect(await postgresRulesStore().list("new")).toHaveLength(1);
  });

  it("does not come back once the person removes it", async () => {
    await seedStartingRule("new");
    const [rule] = await postgresRulesStore().list("new");
    await postgresRulesStore().remove("new", rule.id);
    expect(await seedStartingRule("new")).toBe(false);
    await seedStartingRuleSafely("new");
    expect(await postgresRulesStore().list("new")).toHaveLength(0);
  });

  it("logs a failure and lets sign-in go on", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await expect(seedStartingRuleSafely("no-such-user")).resolves.toBeUndefined();
      expect(log).toHaveBeenCalledWith(expect.stringContaining("qp-starting-rule-failed"));
    } finally {
      log.mockRestore();
    }
  });

  it("is exported with the account and deleted with it, like any rule", async () => {
    await seedStartingRule("new");
    const data = await exportUserData("new");
    expect(JSON.stringify(data?.playbook.rules)).toContain("Keep private matters private");
    await deleteAccount("new");
    expect((await pg.query(`select 1 from qp_rule where user_id = 'new'`)).rows).toHaveLength(0);
  });
});
