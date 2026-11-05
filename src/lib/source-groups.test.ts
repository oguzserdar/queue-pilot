/**
 * @fileoverview A draft's evidence is stored per claim, so one source can carry several quotes. The draft window shows
 * each source once with its quotes inside; these tests pin that grouping and which quotes must stay open.
 */
import { describe, expect, it } from "vitest";
import type { EvidenceCard } from "./source-presentation";
import { groupBySource, quoteNeedsAttention, quoteWarnings } from "./source-groups";

const card = (over: Partial<EvidenceCard>): EvidenceCard => ({
  postId: "p1", snapshotId: "s1", title: "v0.5.0 Drafts with source evidence", uri: "https://github.com/x/releases/v0.5.0",
  claim: "A claim.", quote: "A quote.", locator: null, lastCheckedAt: "2026-11-04T10:00:00Z", needsCheck: false, changed: false,
  scheduled: false, editable: true, oldText: "", newText: "", draftText: "", why: "", sourceKey: "release:v0.5.0", ...over,
});

describe("groupBySource", () => {
  it("shows one source once, with every quote from it in the order written", () => {
    const groups = groupBySource([card({ claim: "First." }), card({ claim: "Second." })]);
    expect(groups).toHaveLength(1);
    expect(groups[0].title).toBe("v0.5.0 Drafts with source evidence");
    expect(groups[0].quotes.map((q) => q.claim)).toEqual(["First.", "Second."]);
  });

  it("keeps different sources apart, even with the same title", () => {
    const groups = groupBySource([card({ sourceKey: "a" }), card({ sourceKey: "b" })]);
    expect(groups).toHaveLength(2);
  });

  it("falls back to the link when a source has no key", () => {
    const groups = groupBySource([card({ sourceKey: undefined, uri: "https://a" }), card({ sourceKey: undefined, uri: "https://a" })]);
    expect(groups).toHaveLength(1);
  });

  it("counts quotes found in the saved source", () => {
    const [g] = groupBySource([card({}), card({ quote: null })]);
    expect(g.found).toBe(1);
  });
});

describe("quoteNeedsAttention", () => {
  it("is true for a missing quote, a changed source or a draft that needs a fresh check", () => {
    expect(quoteNeedsAttention(card({ quote: null }))).toBe(true);
    expect(quoteNeedsAttention(card({ changed: true }))).toBe(true);
    expect(quoteNeedsAttention(card({ needsCheck: true }))).toBe(true);
    expect(quoteNeedsAttention(card({ truncated: true }))).toBe(true);
  });

  it("keeps a quote open for every caption, description and paid-preview warning, from one shared list", () => {
    for (const over of [{ captions: "auto" as const }, { captions: "unknown" as const }, { kind: "video-description" as const }, { paidPreview: true }]) {
      expect(quoteWarnings(card(over)), JSON.stringify(over)).toHaveLength(1);
      expect(quoteNeedsAttention(card(over)), JSON.stringify(over)).toBe(true);
    }
    expect(quoteWarnings(card({ captions: "manual" }))).toEqual([]);
  });

  it("is false for a quote found in an unchanged, whole source", () => {
    expect(quoteNeedsAttention(card({}))).toBe(false);
  });
});
