/**
 * @fileoverview "Suggest changes" on one reviewer comment. A comment is written on one draft's words, so the panel
 * starts with only that draft ticked and listed first; every other draft is the person's choice, through "Select all"
 * or its own box, and the preview button counts what is ticked.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/(app)/review-actions", () => ({ proposeCommentChanges: vi.fn(), keepReviewPreference: vi.fn() }));
vi.mock("@/app/(app)/actions", () => ({ editDraftText: vi.fn() }));

const { ReviewFeedback, firstPicks } = await import("./review-feedback");
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;|&apos;/g, "'").replace(/\s+/g, " ");

// A week of 20 drafts on one account, as on the owner's Reviews page; the comment is on the 7th.
const candidates = Array.from({ length: 20 }, (_, i) => ({ id: `d${i + 1}`, channelId: "x", network: "twitter", label: "@alex", text: `Draft number ${i + 1}.` }));
const panel = (postId: string) => renderToStaticMarkup(<ReviewFeedback linkId="l1" commentId="c1" postId={postId} reviewer="Sam" candidates={candidates} defaultOpen />);
const ticked = (html: string) => html.match(/role="checkbox"[^>]*aria-checked="true"/g)?.length ?? 0;

describe("ReviewFeedback", () => {
  it("starts with only the commented draft ticked, and the button counts one draft", () => {
    const html = panel("d7");
    expect(ticked(html)).toBe(1);
    expect(text(html)).toContain("1 of 20 chosen");
    expect(text(html)).toContain("Preview changes to 1 draft");
    expect(text(html)).not.toContain("Preview changes to 20 drafts");
  });

  it("lists the commented draft first and offers Select all for the rest", () => {
    const t = text(panel("d7"));
    expect(t.indexOf("Draft number 7.")).toBeLessThan(t.indexOf("Draft number 1."));
    expect(t).toContain("Has the comment");
    expect(t).toContain("Select all");
  });

  it("ticks nothing when the commented draft is no longer waiting, and says so", () => {
    const html = panel("gone");
    expect(ticked(html)).toBe(0);
    expect(text(html)).toContain("0 of 20 chosen");
    expect(text(html)).toContain("no longer waiting in Buffer");
  });
});

describe("firstPicks", () => {
  it("is the commented draft alone, or nothing when it is not a candidate", () => {
    expect([...firstPicks(candidates, "d3")]).toEqual(["d3"]);
    expect([...firstPicks(candidates, "elsewhere")]).toEqual([]);
  });
});
