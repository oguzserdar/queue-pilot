/**
 * @fileoverview Shared Buffer request accounting on real Postgres (PGlite, real migrations): parallel calls cannot
 * overspend the shared allowance, an older answer never gives back spent requests, a window rises only after its reset,
 * retries count, one person's burst is paced while another keeps access, the person's own app is held only at zero,
 * a cold start sends one assistant request at a time, and an unreadable count stops the request before Buffer.
 */
import { migratedPglite } from "@/test/migrated-pglite";
import { drizzle } from "drizzle-orm/pglite";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const pg = await migratedPglite();
const testDb = drizzle(pg, { schema: { ...(await import("../../db/schema")), ...(await import("../../db/auth-schema")) } });
const dbState = vi.hoisted(() => ({ broken: false }));
vi.mock("../../db", () => ({ db: () => { if (dbState.broken) throw new Error("db down"); return testDb; }, schema: {} }));

const { bufferQuery } = await import("./client");
const { BufferAllowanceLowError, BufferAllowanceUnknownError, PER_PERSON, TOOL_RESERVE, currentAllowance, releaseRequest, reserveRequest, withBudget } = await import("./budget");

beforeAll(async () => {
  // Reservations belong to a person, so the people these tests act for must exist.
  const ids = ["u0", "u1", "u2", "u3", "u4", "u5", "u6", "u7", "busy", "calm"];
  await pg.query(`insert into "user" (id, name, email) values ${ids.map((id) => `('${id}', '${id}', '${id}@x')`).join(", ")}`);
});
afterAll(async () => { await pg.close(); });
beforeEach(async () => {
  dbState.broken = false;
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  await pg.exec("delete from qp_buffer_allowance; delete from qp_buffer_reservation; delete from qp_request_count;");
});

const T0 = Date.parse("2026-11-05T20:00:00Z");
const reply = (remaining: number, status = 200, extra: Record<string, string> = {}) => new Response(JSON.stringify({ data: { ok: true } }), {
  status, headers: { "content-type": "application/json", ratelimit: `"110-in-15min";r=${remaining};t=600`, ...extra },
});
const seed = async (remaining: number, resetMs = 600_000) => releaseRequest(await reserveRequest(T0), [{ policy: "110-in-15min", remaining, resetSeconds: resetMs / 1000 }], T0);

describe("shared Buffer allowance", () => {
  it("lets parallel assistant calls near the reserve spend only what is left above it", async () => {
    await seed(TOOL_RESERVE + 3);
    const runs = Array.from({ length: 8 }, (_, i) => withBudget("list_tags", `u${i}`, () => reserveRequest(T0 + 1)));
    const results = await Promise.allSettled(runs);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(3);
    expect(results.filter((r) => r.status === "rejected").every((r) => (r as PromiseRejectedResult).reason instanceof BufferAllowanceLowError)).toBe(true);
  });

  it("never lets an older, higher answer give back spent requests within a window", async () => {
    await seed(30);
    await releaseRequest(await reserveRequest(T0 + 1_000), [{ policy: "110-in-15min", remaining: 80, resetSeconds: 590 }], T0 + 1_000);
    expect((await currentAllowance(T0 + 2_000))?.windows[0].remaining).toBe(30);
  });

  it("takes the new count only once the stored window has reset", async () => {
    await seed(5, 60_000);
    await releaseRequest(await reserveRequest(T0 + 61_000), [{ policy: "110-in-15min", remaining: 100, resetSeconds: 900 }], T0 + 61_000);
    expect((await currentAllowance(T0 + 62_000))?.windows[0].remaining).toBe(100);
  });

  it("counts a retried request twice and asks Buffer nothing extra to learn its usage", async () => {
    await seed(100);
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(reply(99, 429, { "retry-after": "1" }))
      .mockResolvedValueOnce(reply(98));
    const { requests } = await withBudget("create_tag", "u1", () => bufferQuery("tok", "{x}", undefined, { fetchImpl, sleep: async () => {}, now: () => T0 + 1 }));
    expect(requests).toBe(2);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect((await currentAllowance(T0 + 2))?.windows[0].remaining).toBe(98);
  });

  it("paces one person's burst while another person still gets through", async () => {
    await seed(1000);
    for (let i = 0; i < PER_PERSON.max; i++) await withBudget("list_tags", "busy", () => reserveRequest(T0 + i)).then(({ result }) => releaseRequest(result, [], T0 + i));
    await expect(withBudget("list_tags", "busy", () => reserveRequest(T0 + 100))).rejects.toBeInstanceOf(BufferAllowanceLowError);
    await expect(withBudget("list_tags", "calm", () => reserveRequest(T0 + 100))).resolves.toBeTruthy();
   // The burst is PER_PERSON.max real reserve-and-release transactions, one after another, so it needs more than 5 s.
  }, 30_000);

  it("holds the person's own app back only at zero, never at the assistant reserve", async () => {
    await seed(2);
    await expect(reserveRequest(T0 + 1)).resolves.toBeTruthy();
    await seed(0);
    await expect(reserveRequest(T0 + 2)).rejects.toBeInstanceOf(BufferAllowanceLowError);
  });

  it("sends one assistant request at a time before Buffer has reported, waiting briefly, then saying it is unknown", async () => {
    const noWait = async () => {};
    const first = await withBudget("list_tags", "u1", () => reserveRequest(T0, noWait));
    await expect(withBudget("list_tags", "u2", () => reserveRequest(T0 + 1, noWait))).rejects.toBeInstanceOf(BufferAllowanceUnknownError);
    await releaseRequest(first.result, [], T0 + 2);
    await expect(withBudget("list_tags", "u2", () => reserveRequest(T0 + 3, noWait))).resolves.toBeTruthy();
  });

  it("treats a window past its stored reset as unknown: one assistant request at a time until Buffer reports", async () => {
    await seed(0, 60_000);
    const noWait = async () => {};
    const first = await withBudget("list_tags", "u1", () => reserveRequest(T0 + 61_000, noWait));
    await expect(withBudget("list_tags", "u2", () => reserveRequest(T0 + 61_001, noWait))).rejects.toBeInstanceOf(BufferAllowanceUnknownError);
    await releaseRequest(first.result, [{ policy: "110-in-15min", remaining: 90, resetSeconds: 900 }], T0 + 61_002);
    await expect(withBudget("list_tags", "u2", () => reserveRequest(T0 + 61_003, noWait))).resolves.toBeTruthy();
  });

  it("counts an answer without a reading as one spent request", async () => {
    await seed(50);
    await releaseRequest(await reserveRequest(T0 + 1), [], T0 + 1);
    expect((await currentAllowance(T0 + 2))?.windows[0].remaining).toBe(49);
  });

  it("stops before Buffer when the shared count cannot be read", async () => {
    dbState.broken = true;
    const fetchImpl = vi.fn(async () => reply(50));
    await expect(bufferQuery("tok", "{x}", undefined, { fetchImpl, now: () => T0 })).rejects.toBeInstanceOf(BufferAllowanceUnknownError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("frees the slot of a request that never answered but charges it, so the window does not get it back", async () => {
    await seed(100);
    await withBudget("list_tags", "u1", () => reserveRequest(T0 + 1));
    await expect(withBudget("list_tags", "u2", () => reserveRequest(T0 + 61_000))).resolves.toBeTruthy();
    expect((await currentAllowance(T0 + 61_001))?.windows[0].remaining).toBe(99);
    expect((await pg.query("select count(*)::int as n from qp_buffer_reservation")).rows).toEqual([{ n: 1 }]);
  });
});
