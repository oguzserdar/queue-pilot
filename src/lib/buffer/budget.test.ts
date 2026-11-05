/**
 * @fileoverview Buffer request accounting: each tool call counts its requests, keeps the newest allowance reading,
 * and stops before Buffer when a window is down to the reserve. Outside a tool call (the person's own app) nothing
 * is held back.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { bufferQuery } from "./client";
import { BufferAllowanceLowError, latestWindows, resetBudgetReadings, withBudget } from "./budget";

const reply = (remaining: number) => new Response(JSON.stringify({ data: { ok: true } }), {
  status: 200, headers: { "content-type": "application/json", ratelimit: `"150-in-15min";r=${remaining};t=600, "525-in-24h";r=400;t=80000` },
});

afterEach(() => { resetBudgetReadings(); vi.restoreAllMocks(); });

describe("withBudget", () => {
  it("counts every Buffer request a tool makes and logs the total", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    const fetchImpl = vi.fn(async () => reply(100));
    const { requests } = await withBudget("list_tags", async () => {
      await bufferQuery("tok", "{a}", undefined, { fetchImpl });
      await bufferQuery("tok", "{b}", undefined, { fetchImpl });
    });
    expect(requests).toBe(2);
    expect(log).toHaveBeenCalledWith(JSON.stringify({ event: "qp-tool-buffer-requests", tool: "list_tags", bufferRequests: 2 }));
  });

  it("keeps the newest reading for the connection, not the one from the last sync", async () => {
    await bufferQuery("tok", "{a}", undefined, { fetchImpl: vi.fn(async () => reply(90)), now: () => 1_000 });
    await bufferQuery("tok", "{a}", undefined, { fetchImpl: vi.fn(async () => reply(60)), now: () => 2_000 });
    expect(latestWindows("tok")).toEqual({ at: 2_000, windows: [
      { policy: "150-in-15min", remaining: 60, resetSeconds: 600 },
      { policy: "525-in-24h", remaining: 400, resetSeconds: 80000 },
    ] });
    expect(latestWindows("other")).toBeNull();
  });

  it("stops a tool before Buffer when a window is down to the reserve, naming when it reopens", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    await bufferQuery("tok", "{a}", undefined, { fetchImpl: vi.fn(async () => reply(15)), now: () => 0 });
    const fetchImpl = vi.fn(async () => reply(14));
    const run = withBudget("create_tag", () => bufferQuery("tok", "{b}", undefined, { fetchImpl, now: () => 1_000 }));
    await expect(run).rejects.toBeInstanceOf(BufferAllowanceLowError);
    await expect(run).rejects.toThrow("15 left until 00:10 UTC");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("lets the tool run again once that window has reset", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    await bufferQuery("tok", "{a}", undefined, { fetchImpl: vi.fn(async () => reply(3)), now: () => 0 });
    const fetchImpl = vi.fn(async () => reply(149));
    await withBudget("create_tag", () => bufferQuery("tok", "{b}", undefined, { fetchImpl, now: () => 601_000 }));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("never holds back the person's own app, which runs outside a tool call", async () => {
    await bufferQuery("tok", "{a}", undefined, { fetchImpl: vi.fn(async () => reply(2)), now: () => 0 });
    const fetchImpl = vi.fn(async () => reply(1));
    await bufferQuery("tok", "{b}", undefined, { fetchImpl, now: () => 1_000 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
