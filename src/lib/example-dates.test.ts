/**
 * @fileoverview Keeps the example account's dates in step: the failed post named on the signed-out Needs you page
 * must be the failed post on the example Delivery page, with the same day and network.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { deliveries } from "./demo-data";

describe("example account dates", () => {
  it("names the same failed post on Needs you and Delivery", () => {
    const failed = deliveries.find((d) => d.tone === "danger");
    expect(failed).toBeDefined();
    const when = new Date(failed!.at);
    const day = when.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).replace(",", "");
    const page = readFileSync(join(__dirname, "../app/(app)/page.tsx"), "utf8");
    const line = page.split("\n").find((l) => l.includes('id: "failed"'));
    expect(line).toContain(`${day}, ${failed!.channel}`);
  });
});
