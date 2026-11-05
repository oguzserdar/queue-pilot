/**
 * @fileoverview approveOffNote: the line beside a switched-off Approve button says what turns it back on and never
 * repeats the reason the Checks list already shows.
 */
import { describe, expect, it } from "vitest";
import { approveOffNote } from "./approve-off-note";

describe("approveOffNote", () => {
  it("says what turns Approve back on, without repeating the reason shown under Checks", () => {
    const stale = { state: "check" as const, stale: true, reason: "The draft or its rules changed. Check it again before approving." };
    expect(approveOffNote(stale)).toBe("Approve stays off until a fresh check passes.");
    const broken = { state: "breaks" as const, reason: 'It breaks "Never say broth." Says broth.' };
    expect(approveOffNote(broken)).toBe("Approve stays off while it breaks a rule. Edit it, then check again.");
    for (const r of [stale, broken]) expect(approveOffNote(r)).not.toContain(r.reason);
  });

  it("has nothing to say when Approve is not off for a playbook reason", () => {
    expect(approveOffNote({ state: "ok" })).toBeUndefined();
    expect(approveOffNote({ state: "flagged", reason: "Flagged." })).toBeUndefined();
    expect(approveOffNote(undefined)).toBeUndefined();
  });
});
