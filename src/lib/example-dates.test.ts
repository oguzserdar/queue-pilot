/**
 * @fileoverview Keeps the example account's dates in step: the failed post named on the signed-out Needs you page is
 * the failed post on the example Delivery page, with the same day and network, whichever week the example shows.
 */
import { describe, expect, it } from "vitest";
import { demoDeliveries } from "./demo-data";
import { exampleNeeds } from "./example-needs";
import { weekdayDayMonth } from "./demo-clock";

describe("example account dates", () => {
  it.each([0, 14, 21, 70])("names the same failed post on Needs you and Delivery (shift %i)", (shift) => {
    const failed = demoDeliveries(shift).find((d) => d.tone === "danger");
    expect(failed).toBeDefined();
    const line = exampleNeeds(shift).find((n) => n.id === "failed");
    expect(line?.detail).toContain(`${weekdayDayMonth(failed!.at)}, ${failed!.channel}`);
  });
});
