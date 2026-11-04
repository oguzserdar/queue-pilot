/**
 * @fileoverview Buffer daily posting limits: one request per organization, documented fields and inputs only.
 */
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { bufferReference, documentedFields } from "./reference.test-support";
import { postingLimits } from "./posting-limits";

const REFERENCE = await bufferReference();
const fieldsOf = (type: string) => documentedFields(REFERENCE, type);

describe("Buffer daily posting limits", () => {
  it("control: a made-up field is caught", () => {
    expect(fieldsOf("DailyPostingLimitStatus").has("madeUpField")).toBe(false);
  });

  it("asks once per organization, only for documented fields, at the given time", async () => {
    const calls: Record<string, unknown>[] = [];
    const run = vi.fn(async (_t: string, _q: string, v?: Record<string, unknown>) => {
      calls.push(v ?? {});
      const ids = (v as { input: { channelIds: string[] } }).input.channelIds;
      return { dailyPostingLimits: ids.map((channelId) => ({ channelId, isAtLimit: channelId === "x1", limit: channelId === "x1" ? 3 : null, scheduled: 2, sent: 1 })) };
    }) as unknown as typeof import("./client").bufferQuery;
    const at = new Date("2026-11-04T12:00:00Z");
    const r = await postingLimits("t", [{ id: "li", organizationId: "o1" }, { id: "x1", organizationId: "o1" }, { id: "th", organizationId: "o2" }], at, run);
    expect(r.requests).toBe(2);
    expect(calls).toEqual([{ input: { channelIds: ["li", "x1"], date: at.toISOString() } }, { input: { channelIds: ["th"], date: at.toISOString() } }]);
    expect(r.limits.find((l) => l.channelId === "x1")).toMatchObject({ isAtLimit: true, limit: 3 });
    for (const f of ["channelId", "isAtLimit", "limit", "scheduled", "sent"]) expect(fieldsOf("DailyPostingLimitStatus").has(f)).toBe(true);
    for (const f of ["channelIds", "date"]) expect(fieldsOf("DailyPostingLimitsInput").has(f)).toBe(true);
  });
});
