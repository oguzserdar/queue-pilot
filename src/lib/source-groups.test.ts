/**
 * @fileoverview A draft's evidence is stored per claim, so one source can carry several quotes. The draft window shows
 * each source once with its quotes inside; these tests pin that grouping and which quotes must stay open.
 */
import { describe, expect, it } from "vitest";
import type { EvidenceCard } from "./source-presentation";
import { groupBySource, quoteNeedsAttention, quoteNotes, quoteProblems, quoteWarnings } from "./source-groups";

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

  it("orders quotes by where their claims sit in the post, not by the order they were saved", () => {
    const draftText = "Drafts now carry sources. Each quote links its moment. Rechecks use the saved copy.";
    const [g] = groupBySource([
      card({ draftText, claim: "Rechecks use the saved copy." }),
      card({ draftText, claim: "Drafts now carry sources." }),
      card({ draftText, claim: "each quote  links its moment." }),
    ]);
    expect(g.quotes.map((q) => q.claim)).toEqual(["Drafts now carry sources.", "each quote  links its moment.", "Rechecks use the saved copy."]);
  });

  it("puts a claim the post no longer contains last, keeping saved order among such claims", () => {
    const draftText = "First line. Second line.";
    const [g] = groupBySource([
      card({ draftText, claim: "Gone A." }),
      card({ draftText, claim: "Second line." }),
      card({ draftText, claim: "Gone B." }),
    ]);
    expect(g.quotes.map((q) => q.claim)).toEqual(["Second line.", "Gone A.", "Gone B."]);
  });

  it("lists sources in the order the post first uses them", () => {
    const draftText = "From the video. From the release.";
    const groups = groupBySource([
      card({ draftText, claim: "From the release.", sourceKey: "release" }),
      card({ draftText, claim: "From the video.", sourceKey: "video" }),
    ]);
    expect(groups.map((g) => g.key)).toEqual(["video", "release"]);
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

describe("quoteProblems and quoteNotes", () => {
  it("treats a missing quote, a changed source and a failed check as problems", () => {
    expect(quoteProblems(card({ quote: null }))).toEqual(["Quote not found in the saved source"]);
    expect(quoteProblems(card({ changed: true, needsCheck: true }))).toEqual(["The source changed after this draft was written"]);
    expect(quoteProblems(card({ needsCheck: true }))).toEqual(["Check this draft against the current source"]);
  });

  it("does not call an edited draft waiting for a check a problem with its quotes", () => {
    expect(quoteProblems(card({ needsCheck: true, edited: true }))).toEqual([]);
    expect(quoteNeedsAttention(card({ needsCheck: true, edited: true }))).toBe(false);
  });

  it("keeps how a quote was read as a note", () => {
    expect(quoteNotes(card({ truncated: true }))).toEqual(["Only part of the source was read"]);
    expect(quoteProblems(card({ truncated: true }))).toEqual([]);
  });
});
