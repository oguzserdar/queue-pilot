/**
 * @fileoverview A screen's optional read that fails still lets the screen render, and the failure is logged.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { readOr } from "./read-or";

afterEach(() => vi.restoreAllMocks());

describe("readOr", () => {
  it("returns the value when the read works, without logging", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await readOr(Promise.resolve([1]), [], "week-written")).toEqual([1]);
    expect(error).not.toHaveBeenCalled();
  });

  it("returns the fallback and logs which read failed", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await readOr(Promise.reject(new Error("db down")), [], "week-written")).toEqual([]);
    expect(JSON.parse(String(error.mock.calls[0][0]))).toEqual({ event: "qp-screen-read-failed", read: "week-written", message: "db down" });
  });
});
