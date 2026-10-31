/**
 * @fileoverview When the daily count starts again, in the person's own time, and the operator's spend card.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AiUsage, resetTime } from "./ai-usage";

describe("resetTime", () => {
  it("shows midnight UTC in the person's zone", () => {
    const now = new Date("2026-10-29T10:00:00Z");
    expect(resetTime("Europe/Istanbul", now)).toBe("03:00");
    expect(resetTime("UTC", now)).toBe("00:00");
    expect(resetTime("America/New_York", now)).toBe("20:00");
  });
});

describe("operator spend card", () => {
  it("shows the real total spent and today's part, even past the budget", () => {
    const html = renderToStaticMarkup(<AiUsage view="operator" today={6} totalCap={null} perPerson={20} budgetUsd={100} leftUsd={0} spentUsd={120} spentTodayUsd={2.5} resetsAt="00:00 UTC" />);
    expect(html).toContain("Spent in total: $120.00, $2.50 of it today. This total never resets.");
  });
});
