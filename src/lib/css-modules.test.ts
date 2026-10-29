/**
 * @fileoverview CSS Modules refuse a selector without a local class (such as "a > svg"), and only the production
 * build reports it. This test fails first, so a broken stylesheet never reaches a deploy.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? files(p) : p.endsWith(".module.css") ? [p] : []; });

/** Splits a selector list on commas outside parentheses, so ":is(h2, h3)" stays one part. */
function topLevel(sel: string): string[] {
  const parts: string[] = [];
  let depth = 0, cur = "";
  for (const ch of sel) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) { parts.push(cur); cur = ""; } else cur += ch;
  }
  return [...parts, cur];
}

describe("CSS Modules", () => {
  it("every top-level selector names a local class", () => {
    const bad: string[] = [];
    for (const f of files(join(__dirname, ".."))) {
      // Selectors at the start of a line, outside at-rule headers and keyframe steps.
      const css = readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
      for (const m of css.matchAll(/^([^@\s{}][^{}]*)\{/gm)) {
        const sel = m[1].trim();
        if (/^(from|to|\d+%)/.test(sel)) continue;
        for (const part of topLevel(sel)) if (!part.includes(".") && !part.includes(":global")) bad.push(`${f.split("/src/")[1]}: ${part.trim()}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
