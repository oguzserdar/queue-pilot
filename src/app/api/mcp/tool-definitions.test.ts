/**
 * @fileoverview Gate on the connector's tool definitions: every tool states readOnlyHint, destructiveHint and
 * openWorldHint as explicit booleans and has a title and a description, and a read-only tool is never destructive.
 */
import { describe, expect, it } from "vitest";
import { mcpToolSource } from "@/test/mcp-tool-sources";

const route = mcpToolSource();
const tools = route.split("registerGuardedTool(server,").slice(1).map((block) => ({
  name: block.match(/^\s*"([a-z_]+)"/)?.[1] ?? "",
  config: block.slice(0, block.indexOf("async (")),
}));
const hint = (config: string, h: string) => config.match(new RegExp(`${h}: (true|false)`))?.[1];

describe("MCP tool definitions", () => {
  it("finds every tool (control)", () => {
    expect(tools.map((t) => t.name)).toContain("save_drafts");
    expect(tools.map((t) => t.name)).toEqual(expect.arrayContaining(["save_my_voice_note", "add_voice_example", "add_material"]))
    expect(tools.length).toBe(41)
  });

  it.each(tools)("$name sets the three hints, a title and a description", ({ config }) => {
    expect(["readOnlyHint", "destructiveHint", "openWorldHint"].filter((h) => hint(config, h) === undefined)).toEqual([]);
    expect(config).toMatch(/title: "/);
    expect(config).toMatch(/description:/);
    // A read-only tool is never destructive.
    expect(hint(config, "readOnlyHint") === "true" ? hint(config, "destructiveHint") : "false").toBe("false");
  });

  // MCP: "If true, this tool may interact with an 'open world' of external entities." Every tool that writes to the
  // person's Buffer reaches outside Queue Pilot, so it says so; a client may treat these with more care.
  const BUFFER_WRITES = ["save_drafts", "update_draft", "delete_draft", "move_back_to_draft", "approve_drafts", "add_draft_note", "update_draft_note", "delete_draft_note", "save_idea", "create_tag", "tag_draft", "save_snippet", "delete_snippet", "rename_tag", "delete_tag"];
  it.each(BUFFER_WRITES)("%s writes to Buffer and is marked open-world and not read-only", (name) => {
    const tool = tools.find((t) => t.name === name);
    expect(tool).toBeDefined();
    expect(hint(tool!.config, "openWorldHint")).toBe("true");
    expect(hint(tool!.config, "readOnlyHint")).toBe("false");
  });
});
