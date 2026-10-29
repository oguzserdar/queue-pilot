/**
 * @fileoverview Keeps the skills pack true to the connector: every tool a skill names in backticks must be registered
 * by the MCP route, every skill's frontmatter must follow the Agent Skills format, and the plugin must point at /api/mcp.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "../..");
const route = readFileSync(join(ROOT, "src/app/api/mcp/route.ts"), "utf8");
const tools = new Set([...route.matchAll(/registerTool\(\s*"([a-z_]+)"/g)].map((m) => m[1]));
const skillsDir = join(ROOT, "plugin/skills");
const skills = readdirSync(skillsDir).map((name) => ({ name, body: readFileSync(join(skillsDir, name, "SKILL.md"), "utf8") }));

describe("skills pack", () => {
  it("finds the registered tools and the skills (control)", () => {
    expect(tools.has("save_drafts")).toBe(true);
    expect(skills.length).toBeGreaterThan(0);
  });

  it.each(skills)("$name names only tools the connector has", ({ body }) => {
    const named = [...body.matchAll(/`([a-z]+(?:_[a-z]+)+)`/g)].map((m) => m[1]);
    expect(named.length).toBeGreaterThan(0);
    expect(named.filter((t) => !tools.has(t))).toEqual([]);
  });

  it.each(skills)("$name has valid frontmatter", ({ name, body }) => {
    const front = body.match(/^---\n([\s\S]*?)\n---\n/)?.[1] ?? "";
    expect(front.match(/^name: (.+)$/m)?.[1]).toBe(name);
    expect(name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    const description = front.match(/^description: (.+)$/m)?.[1] ?? "";
    expect(description.startsWith("Use when")).toBe(true);
    expect(description.length).toBeLessThanOrEqual(1024);
    expect(body.split("\n").length).toBeLessThan(500);
  });

  it("bundles the connector address", () => {
    const mcp = JSON.parse(readFileSync(join(ROOT, "plugin/.mcp.json"), "utf8"));
    expect(mcp.mcpServers["queue-pilot"].url).toMatch(/\/api\/mcp$/);
  });
});
