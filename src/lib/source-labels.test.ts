import { expect, it } from "vitest";
import { sourceTimestamp, sourceCheckedTime, sourceDraftTime } from "./source-labels";
it("renders video time as minutes or hours without changing the link offset", () => {
 expect(sourceTimestamp("t=872")).toBe("14:32"); expect(sourceTimestamp("t=3672")).toBe("1:01:12");
});
it("uses the account timezone and local day, including midnight boundaries", () => {
 expect(sourceCheckedTime("2026-11-01T20:30:00Z", "America/Phoenix", new Date("2026-11-01T22:00:00Z"))).toBe("Today 13:30");
 expect(sourceCheckedTime("2026-11-01T00:30:00Z", "America/Phoenix", new Date("2026-11-01T22:00:00Z"))).toBe("31 Oct 17:30");
 expect(sourceDraftTime("2026-11-03T16:07:00Z", "America/Phoenix")).toContain("9:07");
});
