/**
 * @fileoverview The "Share drafts for review" dialog on a short window. Its list scrolls inside the dialog and the
 * footer with Cancel and Share sits outside that list, so the buttons stay in view. The shared dialog itself keeps its
 * header fixed and scrolls its body, so no tall dialog runs off the window. Screenshots at 754 and 600 px tall check
 * the rest.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/(app)/review-actions", () => ({ shareForReview: vi.fn() }));
// Draw the dialog's content in place: the real one portals to the page only while open.
vi.mock("@/registry/components/dialog/dialog", () => ({
  Dialog: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const { ShareReviewButton } = await import("./share-review-button");
const css = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
const rule = (sheet: string, selector: string) => sheet.match(new RegExp(`(^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\{([^}]*)\\}`))?.[2] ?? "";

describe("Share drafts for review dialog", () => {
  const drafts = Array.from({ length: 20 }, (_, i) => ({ id: `d${i}`, label: `Draft ${i}`, when: "Mon 9:00", text: `Draft text ${i}` }));
  const html = renderToStaticMarkup(<ShareReviewButton drafts={drafts} />);

  it("keeps Cancel and Share outside the list of drafts", () => {
    const list = html.slice(html.indexOf("<ul"), html.indexOf("</ul>"));
    expect(list).toContain("Draft text 19");
    expect(list).not.toContain("Cancel");
    expect(html.indexOf("Cancel")).toBeGreaterThan(html.indexOf("</ul>"));
    expect(html.indexOf("Share 0 drafts")).toBeGreaterThan(html.indexOf("</ul>"));
  });

  it("makes the list the scrolling part, and lets it shrink so the footer fits", () => {
    const sheet = css("./week-view.module.css");
    const list = rule(sheet, ".shareBody > .shareList");
    expect(list).toMatch(/overflow-y: auto/);
    expect(list).toMatch(/flex: 0 1 auto/);
    expect(rule(sheet, ".shareBody")).toMatch(/min-height: 0/);
    expect(rule(sheet, ".shareBody > *")).toMatch(/flex: none/);
  });

  it("uses a dialog that keeps its header in view and scrolls its body", () => {
    const sheet = css("../registry/components/dialog/dialog.module.css");
    expect(rule(sheet, ".content")).toMatch(/display: flex; flex-direction: column; overflow: hidden/);
    expect(rule(sheet, ".header")).toMatch(/flex: none/);
    expect(rule(sheet, ".body")).toMatch(/min-height: 0; overflow: auto; display: flex; flex-direction: column/);
  });
});
