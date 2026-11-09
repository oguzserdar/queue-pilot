/**
 * @fileoverview Channel chips in the post composer and the follow-up panel update from the latest state, so two
 * quick clicks turn on both channels instead of the second overwriting the first.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const files = ["src/components/post-composer.tsx", "src/components/follow-up-panel.tsx"];

describe("channel chips", () => {
  for (const f of files) {
    it(`${f} never builds the next choice from a stale copy`, () => {
      const src = readFileSync(f, "utf8");
      expect(src).not.toMatch(/setOn\(\{\s*\.\.\.on/);
      expect(src).not.toMatch(/setOwn\(\{\s*\.\.\.own/);
      expect(src).not.toMatch(/setText\(\{\s*\.\.\.text/);
    });
  }
});
