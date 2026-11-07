/**
 * @fileoverview When the demo asks a visitor to sign in with Buffer: after a few clicks, once more later, never a third time.
 */
import { describe, expect, it } from "vitest";
import { FIRST_NUDGE, SECOND_NUDGE, nudgeDue } from "./demo-nudge";

describe("nudgeDue", () => {
  it("waits for a few clicks before asking", () => {
    expect(nudgeDue(0, 0)).toBe(false);
    expect(nudgeDue(FIRST_NUDGE - 1, 0)).toBe(false);
    expect(nudgeDue(FIRST_NUDGE, 0)).toBe(true);
  });
  it("asks once more, later, after Keep exploring", () => {
    expect(nudgeDue(FIRST_NUDGE + 1, 1)).toBe(false);
    expect(nudgeDue(SECOND_NUDGE, 1)).toBe(true);
  });
  it("never asks a third time", () => {
    expect(nudgeDue(1000, 2)).toBe(false);
  });
});
