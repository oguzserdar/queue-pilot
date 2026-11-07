/**
 * @fileoverview A dialog opens with focus on the window itself, so its close button does not start with a focus ring.
 */
import { describe, expect, it, vi } from "vitest";
import { focusWindowOnOpen } from "./dialog";

function openEvent(hasAutofocusField = false) {
  const content = { focus: vi.fn(), querySelector: vi.fn(() => (hasAutofocusField ? {} : null)) };
  let prevented = false;
  const event = { currentTarget: content, get defaultPrevented() { return prevented; }, preventDefault: () => { prevented = true; } } as unknown as Event;
  return { event, content };
}

describe("dialog focus on open", () => {
  it("focuses the window, not the close button", () => {
    const { event, content } = openEvent();
    focusWindowOnOpen(event);
    expect(event.defaultPrevented).toBe(true);
    expect(content.focus).toHaveBeenCalledWith({ preventScroll: true });
  });
  it("leaves focus to a field marked autoFocus", () => {
    const { event, content } = openEvent(true);
    focusWindowOnOpen(event);
    expect(event.defaultPrevented).toBe(false);
    expect(content.focus).not.toHaveBeenCalled();
  });
  it("lets the caller's own handler decide first", () => {
    const { event, content } = openEvent();
    focusWindowOnOpen(event, (e) => e.preventDefault());
    expect(content.focus).not.toHaveBeenCalled();
  });
});
