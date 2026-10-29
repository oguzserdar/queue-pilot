import { describe, expect, it } from "vitest";
import { quotaOf, windowOf } from "./rate-limit-text";

describe("rate limit text", () => {
  it("reads Buffer's documented policy names", () => {
    expect([quotaOf("100-in-15min"), windowOf("100-in-15min")]).toEqual(["100", "15 minutes"]);
    expect([quotaOf("250-in-24h"), windowOf("250-in-24h")]).toEqual(["250", "24 hours"]);
    expect([quotaOf("3000-in-30d"), windowOf("3000-in-30d")]).toEqual(["3,000", "30 days"]);
    expect(windowOf("10-in-1h")).toBe("hour");
  });
  it("reads the spelled-out units Buffer sends live, so a line reads per day and per 30 days", () => {
    expect([quotaOf("525-in-1day"), windowOf("525-in-1day")]).toEqual(["525", "day"]);
    expect(quotaOf("15100-in-30days")).toBe("15,100");
    expect(windowOf("15100-in-30days")).toBe("30 days");
    expect(windowOf("110-in-15minutes")).toBe("15 minutes");
    expect(windowOf("60-in-1hour")).toBe("hour");
  });
  it("shows an unknown window as Buffer names it", () => {
    expect(windowOf("5-in-weird")).toBe("weird");
    expect(quotaOf("weird")).toBe("?");
  });
});
