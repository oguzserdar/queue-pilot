/**
 * @fileoverview The words shown when an Approve does not schedule everything.
 * @module lib/approve-problem.test
 */
import { describe, expect, it, vi } from "vitest";
vi.mock("@/app/(app)/actions", () => ({}));
const { approveProblem } = await import("./approve-problem");

describe("approveProblem", () => {
  it("names a refused draft and Buffer's reason", () => {
    expect(approveProblem({ ok: true, approved: [], refused: [{ id: "p", reason: "Its time has passed; pick a new time in Buffer." }] }))
      .toEqual({ title: "1 draft was not scheduled", text: "Its time has passed; pick a new time in Buffer." });
  });
  it("says nothing was scheduled when Buffer's limit is reached", () => {
    expect(approveProblem({ ok: false, kind: "limited", retryAt: "2026-11-12T06:00:00Z" })?.title).toBe("Nothing was scheduled");
  });
  it("is quiet when everything was scheduled", () => {
    expect(approveProblem({ ok: true, approved: ["p"], refused: [] })).toBeNull();
  });
});
