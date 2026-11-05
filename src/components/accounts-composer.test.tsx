/**
 * @fileoverview The several-accounts composer's editing guards: insertion keeps what is written, and the Templates and
 * Hashtags buttons are disabled while a save runs, so nothing can change text the save is already sending.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/(app)/library-actions", () => ({ readComposerTemplates: vi.fn(), readComposerSnippets: vi.fn() }));
vi.mock("@/app/(app)/accounts-actions", () => ({ readComposerAccounts: vi.fn(), saveForAccounts: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const { insertInto } = await import("./accounts-composer");
const { ComposerLibrary } = await import("./composer-library");

describe("insertInto", () => {
  it("fills empty text and appends after a blank line otherwise", () => {
    expect(insertInto("  ", "#soup")).toBe("#soup");
    expect(insertInto("Soup night.\n\n", "#soup")).toBe("Soup night.\n\n#soup");
  });
});

describe("ComposerLibrary while saving", () => {
  it("disables both buttons", () => {
    const html = renderToStaticMarkup(<ComposerLibrary slotId="ch" onInsert={() => {}} disabled />);
    expect(html.match(/<button[^>]*disabled/g)).toHaveLength(2);
    expect(renderToStaticMarkup(<ComposerLibrary slotId="ch" onInsert={() => {}} />)).not.toContain("disabled");
  });
});
