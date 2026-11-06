/**
 * @fileoverview Origin and approver labels for "why this post exists": each comes from a stored record, and a rule
 * with no record gets no origin rather than a guessed one.
 */
import { describe, expect, it } from "vitest";
import { APPROVED_IN_APP, approverLine, ruleOrigin } from "./rule-origin";

describe("ruleOrigin", () => {
  it("names the teammate and the day for a rule kept from a note", () => {
    expect(ruleOrigin({ learnedFrom: { kind: "note", author: "Sam", at: "2026-11-01T21:05:00Z" } })).toBe("A note from Sam on 1 Nov");
    expect(ruleOrigin({ learnedFrom: { kind: "note", by: "Priya", at: "2026-10-30T09:00:00Z" } })).toBe("A note from Priya on 30 Oct");
    expect(ruleOrigin({ learnedFrom: { kind: "note", author: null, at: null } })).toBe("A note from a teammate");
  });

  it("says how often the person made the edit a rule came from", () => {
    expect(ruleOrigin({ learnedFrom: { fix: {}, count: 2 } })).toBe("Your edit, twice");
    expect(ruleOrigin({ learnedFrom: { fix: {}, count: 4 } })).toBe("Your edit, 4 times");
  });

  it("tells a rule the person added from one their AI added", () => {
    expect(ruleOrigin({ addedBy: "you" })).toBe("Added by you");
    expect(ruleOrigin({ addedBy: { app: "Claude" } })).toBe("Added by your AI (Claude)");
  });

  it("names review comments, past posts and rewrites", () => {
    expect(ruleOrigin({ learnedFrom: { kind: "review", comment: "x" } })).toBe("A reviewer's comment");
    expect(ruleOrigin({ learnedFrom: { kind: "posts" } })).toBe("Your past posts");
    expect(ruleOrigin({ learnedFrom: [{ before: "a", after: "b" }] })).toBe("Your rewrites");
  });

  it("gives no origin when nothing was recorded", () => {
    expect(ruleOrigin({})).toBeNull();
    expect(ruleOrigin({ learnedFrom: { excerpt: "…", truncated: true } })).toBeNull();
  });
});

describe("approverLine", () => {
  it("says whether the person approved in the app or which AI app did", () => {
    expect(approverLine(APPROVED_IN_APP)).toBe("Approved by you in Queue Pilot");
    expect(approverLine("Claude")).toBe("Approved through Claude");
    expect(approverLine(undefined)).toBeNull();
  });
});
