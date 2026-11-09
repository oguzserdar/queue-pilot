/**
 * @fileoverview Buffer raises an app's quota as more people authorize it, and names each policy after its quota, so
 * the name changes ("110-in-15min" becomes "120-in-15min"). Its guide says to match a policy by its window length
 * (RateLimit-Policy w). These tests run the real reservation code on PGlite with the real migrations.
 */
import { migratedPglite } from "@/test/migrated-pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const pg = await migratedPglite();
const testDb = drizzle(pg, { schema: { ...(await import("../../db/schema")), ...(await import("../../db/auth-schema")) } });
vi.mock("../../db", () => ({ db: () => testDb, schema: {} }));

const { parseRateLimit } = await import("./client");
const { TOOL_RESERVE, currentAllowance, releaseRequest, reserveRequest, withBudget } = await import("./budget");

beforeAll(async () => {
  await pg.query(`insert into "user" (id, name, email) values ('u1', 'u1', 'u1@x')`);
});
afterAll(async () => { await pg.close(); });
beforeEach(async () => {
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  await pg.exec("delete from qp_buffer_allowance; delete from qp_buffer_reservation; delete from qp_request_count;");
});

const T0 = Date.parse("2026-11-06T20:00:00Z");
/** Buffer's two headers for one 15-minute window with this quota and remaining count. */
const headers = (quota: number, remaining: number) => parseRateLimit(`"${quota}-in-15min";r=${remaining};t=600`, `"${quota}-in-15min";q=${quota};w=900;pk=:x:`);
const answer = async (at: number, windows: ReturnType<typeof headers>, startedAt = at) => releaseRequest(await reserveRequest(startedAt), windows, at);
const fifteen = async (now: number) => (await currentAllowance(now))!.windows.filter((w) => w.policy.endsWith("/900s"));

describe("a window whose quota changes", () => {
  it("keys a window by its length when Buffer gives the policy's window", () => {
    expect(headers(150, 98)).toEqual([{ policy: "150/900s", remaining: 98, resetSeconds: 600, windowSeconds: 900 }]);
    expect(parseRateLimit('"150-in-15min";r=98;t=600')).toEqual([{ policy: "150-in-15min", remaining: 98, resetSeconds: 600 }]);
  });

  it("replaces the old quota with the new one instead of keeping both", async () => {
    await answer(T0, headers(110, 16));
    await answer(T0 + 1_000, headers(120, 24));
    expect((await fifteen(T0 + 2_000)).map((w) => [w.policy, w.remaining])).toEqual([["120/900s", 24]]);
    // An assistant call is not refused locally: the new quota leaves more than the reserve.
    expect(TOOL_RESERVE).toBeLessThan(24);
    await expect(withBudget("list_tags", "u1", () => reserveRequest(T0 + 3_000))).resolves.toBeTruthy();
  });

  it("lets a late answer from before the new quota change nothing", async () => {
    await answer(T0, headers(110, 16));
    await answer(T0 + 2_000, headers(120, 24));
    // Sent before the new quota was seen, answered after it: its old reading changes nothing, but the request it
    // made still counts against the window, as any answer that leaves a window out does.
    await answer(T0 + 3_000, headers(110, 15), T0 + 1_000);
    expect((await fifteen(T0 + 4_000)).map((w) => [w.policy, w.remaining])).toEqual([["120/900s", 23]]);
  });

  it("drops a window stored under Buffer's name once windows come keyed by length", async () => {
    await releaseRequest(await reserveRequest(T0), [{ policy: "110-in-15min", remaining: 16, resetSeconds: 600 }], T0);
    await answer(T0 + 1_000, headers(120, 24));
    expect((await currentAllowance(T0 + 2_000))!.windows.map((w) => w.policy)).toEqual(["120/900s"]);
  });

  it("keeps a window stored under Buffer's name when the keyed answer does not cover that window", async () => {
    // The daily window was saved by name with 12 left; an answer keys only the 15-minute window.
    await releaseRequest(await reserveRequest(T0), [{ policy: "600-in-1day", remaining: 12, resetSeconds: 3_600 }], T0);
    await answer(T0 + 1_000, headers(120, 24));
    const daily = (await currentAllowance(T0 + 2_000))!.windows.find((w) => w.policy === "600-in-1day");
    expect(daily?.remaining).toBeLessThanOrEqual(12);
    await expect(withBudget("list_tags", "u1", () => reserveRequest(T0 + 3_000))).rejects.toThrow();
  });
});
