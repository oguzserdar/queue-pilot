/**
 * @fileoverview The table of Buffer operations in docs/buffer-api-notes.md matches the code and Buffer's reference:
 * every operation the code calls is listed as used, every listed one is called, and the totals are right.
 * @module lib/buffer/operations-used.test
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { bufferReference } from "./reference.test-support";

const REFERENCE = await bufferReference();
const section = (from: string, to: string) => REFERENCE.slice(REFERENCE.indexOf(from), REFERENCE.indexOf(to));
const roots = (s: string) => [...s.matchAll(/^#### (\w+)$/gm)].map((m) => m[1]);
const QUERIES = roots(section("## Queries", "## Mutations"));
const MUTATIONS = roots(section("## Mutations", "## Object Types"));

/** Every non-test source file under src, joined. */
function source(dir = "src"): string {
  return readdirSync(dir).map((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return source(p);
    return /\.tsx?$/.test(f) && !/\.test\.|test-support/.test(f) ? readFileSync(p, "utf8") : "";
  }).join("\n");
}
const SRC = source();
const calls = (op: string) => new RegExp(`[\\s{]${op}\\s*[({]`).test(SRC);

const DOC = readFileSync("docs/buffer-api-notes.md", "utf8");
const usedTable = DOC.slice(DOC.indexOf("## Every Buffer operation"), DOC.indexOf("Not used, on purpose"));
const unusedTable = DOC.slice(DOC.indexOf("Not used, on purpose"), DOC.indexOf("\n## ", DOC.indexOf("Not used, on purpose")));
const listed = (t: string) => new Set([...t.matchAll(/`(\w+)`/g)].map((m) => m[1]).filter((n) => QUERIES.includes(n) || MUTATIONS.includes(n)));

describe("the Buffer operations table", () => {
  it("control: the reference has queries and mutations, and a made-up one is not called", () => {
    expect(QUERIES).toContain("posts");
    expect(MUTATIONS).toContain("createPost");
    expect(calls("notARealOperationQP")).toBe(false);
  });

  it("lists as used exactly the operations the code calls", () => {
    const called = [...QUERIES, ...MUTATIONS].filter(calls).sort();
    expect([...listed(usedTable)].sort()).toEqual(called);
  });

  it("lists every other operation in Buffer's reference as not used", () => {
    const rest = [...QUERIES, ...MUTATIONS].filter((op) => !calls(op)).sort();
    expect([...listed(unusedTable)].sort()).toEqual(rest);
  });

  it("states the right totals", () => {
    const q = QUERIES.filter(calls).length, m = MUTATIONS.filter(calls).length;
    expect(DOC).toContain(`${q + m} of the ${QUERIES.length + MUTATIONS.length} operations`);
    expect(DOC).toContain(`${q} of ${QUERIES.length} queries and ${m} of ${MUTATIONS.length} mutations`);
  });

  it("gives the same count on the homepage and in the README", () => {
    const used = [...QUERIES, ...MUTATIONS].filter(calls).length, all = QUERIES.length + MUTATIONS.length;
    expect(readFileSync("README.md", "utf8")).toContain(`${used} of the ${all} operations in Buffer's API`);
    expect(readFileSync("src/app/(landing)/home/page.tsx", "utf8")).toContain(`${used} of Buffer's ${all} operations`);
  });
});
