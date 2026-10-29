import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Real Postgres (PGLite) with the real migrations, behind the app's Drizzle client.
const pg = new PGlite();
const testDb = drizzle(pg, { schema: { ...(await import("../db/schema")), ...(await import("../db/auth-schema")) } });
vi.mock("../db", () => ({ db: () => testDb, schema: {} }));

const { capMessage, postgresAllowanceStore, utcDay } = await import("./ai-allowance");

beforeAll(async () => {
  await migrate(testDb, { migrationsFolder: join(__dirname, "../../drizzle"), migrationsTable: "__drizzle_migrations__", migrationsSchema: "public" });
  await pg.query(`insert into "user" (id, name, email) values ('a', 'a', 'a@x'), ('b', 'b', 'b@x'), ('c', 'c', 'c@x')`);
});
afterAll(async () => { await pg.close(); });

describe("built-in AI allowance on real Postgres", () => {
  it("allows up to the per-person cap, then refuses without counting the refusal", async () => {
    const s = postgresAllowanceStore();
    const caps = { perPerson: 2, total: 100 };
    expect(await s.take("a", "2026-10-28", caps)).toBe("ok");
    expect(await s.take("a", "2026-10-28", caps)).toBe("ok");
    expect(await s.take("a", "2026-10-28", caps)).toBe("person");
    expect(await s.used("a", "2026-10-28")).toEqual({ mine: 2, total: 2 });
  });

  it("starts again on a new UTC day", async () => {
    const s = postgresAllowanceStore();
    expect(await s.take("a", "2026-10-29", { perPerson: 2, total: 100 })).toBe("ok");
    expect(await s.used("a", "2026-10-29")).toEqual({ mine: 1, total: 1 });
  });

  it("stops everyone at the total cap, and a refused person does not spend the total", async () => {
    const s = postgresAllowanceStore();
    const caps = { perPerson: 1, total: 2 };
    const day = "2026-10-30";
    expect(await s.take("a", day, caps)).toBe("ok");
    expect(await s.take("a", day, caps)).toBe("person");
    expect(await s.take("b", day, caps)).toBe("ok");
    expect(await s.take("c", day, caps)).toBe("total");
    expect(await s.used("c", day)).toEqual({ mine: 0, total: 2 });
  });

  it("lets only one of two simultaneous requests take the last slot", async () => {
    const s = postgresAllowanceStore();
    const caps = { perPerson: 1, total: 100 };
    const results = await Promise.all([s.take("b", "2026-10-31", caps), s.take("b", "2026-10-31", caps)]);
    expect(results.sort()).toEqual(["ok", "person"]);
  });

  it("refuses everything when a cap is set to zero", async () => {
    const s = postgresAllowanceStore();
    expect(await s.take("a", "2026-11-01", { perPerson: 0, total: 100 })).toBe("person");
    expect(await s.take("a", "2026-11-01", { perPerson: 5, total: 0 })).toBe("total");
    expect(await s.used("a", "2026-11-01")).toEqual({ mine: 0, total: 0 });
  });
});

describe("giving an action back when the AI call fails", () => {
  it("returns the action to the person and to the total, never below zero", async () => {
    const s = postgresAllowanceStore();
    const caps = { perPerson: 1, total: 100 };
    expect(await s.take("c", "2026-11-02", caps)).toBe("ok");
    await s.giveBack("c", "2026-11-02");
    expect(await s.used("c", "2026-11-02")).toEqual({ mine: 0, total: 0 });
    expect(await s.take("c", "2026-11-02", caps)).toBe("ok");
    await s.giveBack("c", "2026-11-03");
    expect(await s.used("c", "2026-11-03")).toEqual({ mine: 0, total: 0 });
  });
});

describe("money spent on the built-in key", () => {
  it("records each action's cost for the person and the day, and sums every day against the budget", async () => {
    const s = postgresAllowanceStore();
    await s.addCost("a", "2026-11-05", 40_000);
    await s.addCost("b", "2026-11-05", 10_000);
    await s.addCost("a", "2026-11-06", 5_000);
    expect(await s.spentMicros()).toBeGreaterThanOrEqual(55_000);
    const before = await s.spentMicros();
    await s.addCost("a", "2026-11-07", 1_000);
    expect(await s.spentMicros()).toBe(before + 1_000);
  });
});

describe("utcDay and capMessage", () => {
  it("counts by the UTC date", () => {
    expect(utcDay(new Date("2026-10-28T23:30:00-07:00"))).toBe("2026-10-29");
  });
  it("tells the person how to get past the cap", () => {
    expect(capMessage("person", { perPerson: 20, total: 300 })).toMatch(/20 AI actions.*own key/);
    expect(capMessage("total", { perPerson: 20, total: 300 })).toMatch(/own key/);
  });
});
