/**
 * @fileoverview Gate on the connector's tool definitions: every tool states readOnlyHint, destructiveHint and
 * openWorldHint as explicit booleans and has a title and a description, and a read-only tool is never destructive.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const route = readFileSync(join(__dirname, "route.ts"), "utf8");
const tools = route.split("server.registerTool(").slice(1).map((block) => ({
  name: block.match(/^\s*"([a-z_]+)"/)?.[1] ?? "",
  config: block.slice(0, block.indexOf("async (")),
}));
const hint = (config: string, h: string) => config.match(new RegExp(`${h}: (true|false)`))?.[1];

describe("MCP tool definitions", () => {
  it("finds every tool (control)", () => {
    expect(tools.map((t) => t.name)).toContain("save_drafts");
    expect(tools.length).toBeGreaterThanOrEqual(11);
  });

  it.each(tools)("$name sets the three hints, a title and a description", ({ config }) => {
    for (const h of ["readOnlyHint", "destructiveHint", "openWorldHint"]) expect(hint(config, h), h).toBeDefined();
    expect(config).toMatch(/title: "/);
    expect(config).toMatch(/description:/);
    if (hint(config, "readOnlyHint") === "true") expect(hint(config, "destructiveHint")).toBe("false");
  });
});
