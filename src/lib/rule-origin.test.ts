/**
 * @fileoverview Origin and approver labels for "why this post exists": each comes from a stored record, and a rule
 * with no record gets no origin rather than a guessed one.
 */
import { describe, expect, it } from "vitest";
import { APPROVED_IN_APP, approverFor, approverLine, ruleOrigin, serializeApprover } from "./rule-origin";

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
    expect(ruleOrigin({ addedBy: { app: "Claude", verified: true } })).toBe("Added by your AI (Claude)");
    expect(ruleOrigin({ addedBy: { app: "claude", verified: false } })).toBe('Added by an unverified app named "claude"');
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
  const LAST = "Last approved through Queue Pilot:";
  it("says it is the last approval recorded through Queue Pilot, by whom and on which day", () => {
    expect(approverLine(APPROVED_IN_APP, "2026-11-03T09:00:00Z")).toBe(`${LAST} by you, 3 Nov`);
    expect(approverLine("Claude", "2026-11-03T09:00:00Z")).toBe(`${LAST} by Claude, 3 Nov`);
    expect(approverLine(APPROVED_IN_APP)).toBe(`${LAST} by you`);
    expect(approverLine(undefined, "2026-11-03T09:00:00Z")).toBeNull();
  });

  it("never words a recorded approval as who approved the post now", () => {
    for (const line of [approverLine(APPROVED_IN_APP), approverLine("Claude", "2026-11-03T09:00:00Z")]) expect(line).not.toMatch(/^Approved/);
  });

  it("stores the approver as a tagged value no client name can turn into the in-app wording", () => {
    expect(approverLine(serializeApprover(APPROVED_IN_APP))).toBe(`${LAST} by you`);
    for (const name of ["queue-pilot", "Queue Pilot", '{"via":"app"}']) {
      const stored = serializeApprover(approverFor({ name, verified: false }));
      expect(approverLine(stored)).toBe(`${LAST} by an unverified app named "${name}"`);
    }
    expect(approverLine(serializeApprover(approverFor({ name: "Claude", verified: true })))).toBe(`${LAST} by Claude`);
  });

  it("still reads rows written in the old string form", () => {
    expect(approverLine("queue-pilot")).toBe(`${LAST} by you`);
    expect(approverLine("Claude")).toBe(`${LAST} by Claude`);
    expect(approverLine("{not json")).toBe(`${LAST} by {not json`);
  });
});
