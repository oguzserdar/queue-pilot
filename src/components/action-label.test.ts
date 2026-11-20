/**
 * @fileoverview The words on a read or check button: busy words while it runs, again words once an answer is on
 * screen, first words before that; running wins over a shown answer.
 */
import { describe, expect, it } from "vitest";
import { actionLabel } from "./action-label";

const WORDS = { busy: "Reading…", again: "Read again", first: "Read it" };

describe("actionLabel", () => {
  it.each([
    [false, false, "Read it"],
    [false, true, "Read again"],
    [true, false, "Reading…"],
    [true, true, "Reading…"],
  ])("busy %s, done %s says %s", (busy, done, words) => {
    expect(actionLabel(busy, done, WORDS)).toBe(words);
  });
});
