/**
 * @fileoverview When the daily count starts again, in the person's own time.
 */
import { describe, expect, it } from "vitest";
import { resetTime } from "./ai-usage";

describe("resetTime", () => {
  it("shows midnight UTC in the person's zone", () => {
    const now = new Date("2026-10-29T10:00:00Z");
    expect(resetTime("Europe/Istanbul", now)).toBe("03:00");
    expect(resetTime("UTC", now)).toBe("00:00");
    expect(resetTime("America/New_York", now)).toBe("20:00");
  });
});
