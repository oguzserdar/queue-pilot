/**
 * @fileoverview Every connector tool that writes to Buffer counts against the per-person Buffer write allowance.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const src = readFileSync("src/app/api/mcp/route.ts", "utf8");
const table = src.slice(src.indexOf("const TOOL_LIMIT"), src.indexOf("};", src.indexOf("const TOOL_LIMIT")));

describe("the connector's write allowance", () => {
  it("covers the tools that tag, note and save ideas in Buffer", () => {
    for (const tool of ["tag_draft", "create_tag", "add_draft_note", "update_draft_note", "delete_draft_note", "save_idea", "update_draft", "delete_draft", "save_drafts"]) {
      expect(table).toMatch(new RegExp(`\\b${tool}: "bufferWrite"`));
    }
  });
});
