/**
 * @fileoverview Tests for the shortcut table and the sequence matcher: sequences complete only in order and in time,
 * a wrong second key starts over, and keys typed in a field or dialog never count.
 */
import { describe, expect, it } from "vitest";
import { isTypingTarget, SEQUENCE_MS, SHORTCUTS, sequenceMatcher } from "./shortcuts";

describe("shortcuts", () => {
  it("G then P goes to the week, N then P starts a new post", () => {
    const m = sequenceMatcher();
    expect(m.step("g", 0)).toBeNull();
    expect(m.step("p", 300)?.run).toEqual({ to: "/week" });
    expect(m.step("n", 1000)).toBeNull();
    expect(m.step("p", 1200)?.run).toEqual({ action: "new-post" });
  });

  it("a second key after the window, or a wrong one, starts over", () => {
    const m = sequenceMatcher();
    m.step("g", 0);
    expect(m.step("p", SEQUENCE_MS + 1)).toBeNull();
    m.step("g", 5000);
    expect(m.step("x", 5100)).toBeNull();
    expect(m.step("p", 5200)).toBeNull();
    m.step("g", 9000);
    expect(m.step("g", 9100)).toBeNull();
    expect(m.step("h", 9200)?.run).toEqual({ to: "/" });
  });

  it("every sequence is unique and every page has one", () => {
    const seqs = SHORTCUTS.filter((s) => s.sequence).map((s) => s.keys.join(" "));
    expect(new Set(seqs).size).toBe(seqs.length);
    const pages = SHORTCUTS.flatMap((s) => ("to" in s.run ? [s.run.to] : []));
    expect(pages).toEqual(expect.arrayContaining(["/", "/week", "/delivery", "/playbook", "/voice", "/ideas", "/sources", "/connect", "/settings"]));
  });

  it("keys typed in fields and dialogs are not shortcuts", () => {
    const el = (tagName: string, opts: { role?: string; editable?: boolean; inDialog?: boolean } = {}) =>
      ({ tagName, isContentEditable: !!opts.editable, getAttribute: (n: string) => (n === "role" ? opts.role ?? null : null), closest: () => (opts.inDialog ? {} : null) }) as unknown as Element;
    expect(isTypingTarget(el("INPUT"))).toBe(true);
    expect(isTypingTarget(el("TEXTAREA"))).toBe(true);
    expect(isTypingTarget(el("DIV", { editable: true }))).toBe(true);
    expect(isTypingTarget(el("DIV", { role: "combobox" }))).toBe(true);
    expect(isTypingTarget(el("BUTTON", { inDialog: true }))).toBe(true);
    expect(isTypingTarget(el("BUTTON"))).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});
