/**
 * @fileoverview Codex's independent regressions for the shared Buffer allowance, kept as written: an expired
 * reservation is never refunded, a partial answer charges the windows it left out, and a delayed answer from before a
 * reset cannot raise the window after it.
 */
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const pg = new PGlite();
const testDb = drizzle(pg, { schema: { ...(await import("../../db/schema")), ...(await import("../../db/auth-schema")) } });
const dbState = vi.hoisted(() => ({ broken: false }));
vi.mock("../../db", () => ({ db: () => { if (dbState.broken) throw new Error("db down"); return testDb; }, schema: {} }));

const { bufferQuery } = await import("./client");
const { BufferAllowanceLowError, BufferAllowanceUnknownError, PER_PERSON, TOOL_RESERVE, currentAllowance, releaseRequest, reserveRequest, withBudget } = await import("./budget");

beforeAll(async () => {
  await migrate(testDb, { migrationsFolder: join(__dirname, "../../../drizzle"), migrationsTable: "__drizzle_migrations__", migrationsSchema: "public" });
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


describe("Codex independent failure cases", () => {
 it("does not refund a potentially spent request when its reservation expires", async () => {
   await seed(TOOL_RESERVE + 1);
   await withBudget("list_tags", "u1", () => reserveRequest(T0 + 1));
   await expect(withBudget("list_tags", "u2", () => reserveRequest(T0 + 61_001))).rejects.toBeInstanceOf(BufferAllowanceLowError);
 });
 it("counts a request against known policies missing from a partial header", async () => {
   await releaseRequest(await reserveRequest(T0), [
     {policy:"110-in-15min",remaining:50,resetSeconds:600},
     {policy:"525-in-24h",remaining:16,resetSeconds:86400}
   ], T0);
   await releaseRequest(await reserveRequest(T0+1), [{policy:"110-in-15min",remaining:49,resetSeconds:600}], T0+1);
   expect((await currentAllowance(T0+2))?.windows.find(w=>w.policy==="525-in-24h")?.remaining).toBe(15);
 });
 it("does not raise an expired window from a delayed pre-reset response", async () => {
   await seed(100,20_000);
   const delayed = await reserveRequest(T0+1);
   await releaseRequest(await reserveRequest(T0+10_000), [{policy:"110-in-15min",remaining:5,resetSeconds:10}], T0+10_000);
   await releaseRequest(delayed,[{policy:"110-in-15min",remaining:99,resetSeconds:20}],T0+21_000);
   expect((await currentAllowance(T0+21_001))?.windows[0].remaining).toBeLessThanOrEqual(5);
 });
});
