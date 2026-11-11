/**
 * @fileoverview A draft's sources in the draft window. After an edit, the draft says once what to do, with its button,
 * instead of a warning on every quote. A note about how a quote was read stays quiet, and a real problem is marked in
 * words, not only in colour.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { EvidenceCard } from "@/lib/source-presentation";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/app/(app)/source-actions", () => ({ checkMySources: vi.fn(), recheckSourceEvidence: vi.fn(), applySourceFix: vi.fn() }));

const { DraftSources } = await import("./source-evidence");
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;|&apos;/g, "'").replace(/\s+/g, " ");
const count = (haystack: string, needle: string) => haystack.split(needle).length - 1;

const card = (over: Partial<EvidenceCard>): EvidenceCard => ({
  postId: "p1", snapshotId: "s1", sourceKey: "feed:41", title: "This Week in AI 41", uri: "https://example.com/41",
  claim: "A claim.", quote: "A quote.", locator: null, lastCheckedAt: "2026-11-04T10:00:00Z", needsCheck: false, changed: false,
  scheduled: false, editable: true, oldText: "", newText: "", draftText: "", why: "", ...over,
});

describe("DraftSources after an edit", () => {
  const edited = [card({ claim: "First.", needsCheck: true, edited: true, truncated: true }), card({ claim: "Second.", needsCheck: true, edited: true })];
  const t = text(renderToStaticMarkup(<DraftSources cards={edited} live />));

  it("says once what to do, with a Check again button", () => {
    expect(count(t, "You edited this draft. Check it again before approving.")).toBe(1);
    expect(t).toContain("Check again");
    expect(t).not.toContain("Recheck draft");
  });

  it("stays quiet about the edit when the window's footer already offers the check", () => {
    const quiet = text(renderToStaticMarkup(<DraftSources cards={edited} live footerChecks />));
    expect(quiet).not.toContain("You edited this draft");
    expect(quiet).not.toContain("Check again");
    expect(quiet).not.toContain("Recheck draft");
    expect(quiet).toContain("Note: Only part of the source was read");
  });

  it("does not repeat a warning on every quote", () => {
    expect(t).not.toContain("Check this draft against the current source");
    expect(t).not.toContain("Problem:");
  });

  it("shows a partly read source as a note, not a problem", () => {
    expect(t).toContain("Note: Only part of the source was read");
  });
});

describe("DraftSources with a real problem", () => {
  it("names a quote missing from the source as a problem", () => {
    const t = text(renderToStaticMarkup(<DraftSources cards={[card({ quote: null, needsCheck: true })]} live />));
    expect(t).toContain("Problem: Quote not found in the saved source");
    expect(t).toContain("Recheck draft");
    expect(t).not.toContain("You edited this draft");
  });
});
