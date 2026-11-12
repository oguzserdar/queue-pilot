/**
 * @fileoverview Enter handlers ignore Enter while an input method is composing (Japanese, Chinese, Korean), so picking
 * a character never submits. Pattern from Chrome's Modern Web Guidance, "ime-safe-enter-submit".
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return files(p);
    return /\.tsx$/.test(n) && !/\.test\.tsx$/.test(n) ? [p] : [];
  });
}

// Enter on a button, chart, grid or toggle has no text being composed, and Cmd/Ctrl+Enter is never part of composing.
const notText = [
  "activity-heatmap", "calendar.tsx", "date-picker", "donut-chart", "file-upload", "floating-button-group", "radio-cards",
  "resizable-panels", "time-picker", "tree-view", "treemap",
];
const sendShortcut = /metaKey \|\| [a-z]+\.ctrlKey|\(e\.metaKey|\(event\.metaKey/;

describe("Enter in a text field", () => {
  it("checks isComposing wherever a keydown handler acts on Enter", () => {
    const offenders: string[] = [];
    for (const f of files("src")) {
      const src = readFileSync(f, "utf8");
      src.split("\n").forEach((line, i) => {
        if (notText.some((n) => f.includes(n)) || sendShortcut.test(line)) return;
        if (/onKeyDown|keydown/i.test(src) && /\.key === "Enter"/.test(line) && !/isComposing/.test(line)) offenders.push(`${f}:${i + 1}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});
