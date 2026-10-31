/**
 * @fileoverview Word-level diff for proposed edits.
 */
import { describe, expect, it } from "vitest";
import { wordDiff } from "./word-diff";

const side = (parts: ReturnType<typeof wordDiff>, keep: "removed" | "added") => parts.filter((p) => p.kind === "same" || p.kind === keep).map((p) => p.text).join("");

describe("wordDiff", () => {
  it("marks only the changed word", () => {
    expect(wordDiff("Queue Pilot opens on Monday.", "Queue Pilot opens on Tuesday.")).toEqual([
      { kind: "same", text: "Queue Pilot opens on " }, { kind: "removed", text: "Monday." }, { kind: "added", text: "Tuesday." },
    ]);
  });
  it("gives each side back exactly, line breaks included", () => {
    const before = "Day 4 of Queue Pilot:\nreviews ship today.";
    const after = "Day 4 of QP:\nreview links ship today!";
    const parts = wordDiff(before, after);
    expect(side(parts, "removed")).toBe(before);
    expect(side(parts, "added")).toBe(after);
  });
  it("handles empty sides", () => {
    expect(wordDiff("", "New post.")).toEqual([{ kind: "added", text: "New post." }]);
    expect(wordDiff("Old.", "")).toEqual([{ kind: "removed", text: "Old." }]);
  });
});
