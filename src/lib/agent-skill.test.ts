/**
 * @fileoverview The agent skill stays true to the connector: every tool it offers is described, the digest in the
 * index matches the file, and the deployment's own address is the one it tells the AI to connect to.
 */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PLUGIN_SKILLS } from "./plugin-skills";
import { SKILL_DESCRIPTION, SKILL_TOOL_NAMES, servedSkills, skillIndex, skillMarkdown, skillArchive } from "./agent-skill";

const origin = "https://qp.example.com";

describe("agent skill", () => {
  it("describes every tool the connector registers, and no tool it does not", () => {
    const route = readFileSync(join(__dirname, "../app/api/mcp/route.ts"), "utf8") + readFileSync(join(__dirname, "mcp-controls.ts"), "utf8") + readFileSync(join(__dirname, "mcp-content-items.ts"), "utf8");
    const registered = [...route.matchAll(/registerTool\(\s*"([a-z_]+)"/g)].map((m) => m[1]).sort();
    expect(registered.length).toBeGreaterThan(5);
    expect([...SKILL_TOOL_NAMES].sort()).toEqual(registered);
  });

  it("points the AI at this deployment's connector", () => {
    expect(skillMarkdown(origin)).toContain(`${origin}/api/mcp`);
  });

  it("explains how to teach voice and keep research", () => {
    expect(SKILL_TOOL_NAMES).toEqual(expect.arrayContaining(["save_my_voice_note", "add_voice_example", "add_material"]))
    expect(skillMarkdown(origin)).toContain("Up to 2000 characters and eight examples")
  })

  it("starts with Agent Skills front matter a YAML parser accepts", () => {
    const m = skillMarkdown(origin).match(/^---\nname: queue-pilot\ndescription: (.+)\n---\n/);
    expect(m).not.toBeNull();
    // Unquoted, the ": " inside the description would end the YAML value early. A JSON string is valid YAML.
    expect(JSON.parse(m![1])).toBe(SKILL_DESCRIPTION);
  });

  it("lists the skill in the index with the digest of the file it serves", () => {
    const entry = skillIndex(origin).skills[0];
    expect(entry.url).toBe("/.well-known/agent-skills/queue-pilot/SKILL.md");
    expect(entry.digest).toBe(`sha256:${createHash("sha256").update(skillMarkdown(origin)).digest("hex")}`);
    expect(skillIndex(origin).$schema).toBe("https://schemas.agentskills.io/discovery/0.2.0/schema.json");
  });

  it("lists every skill it serves, each with the digest of what is served: SKILL.md alone, or the archive", () => {
    const served = servedSkills(origin);
    const index = skillIndex(origin).skills;
    expect(index.map((e) => e.name).sort()).toEqual(Object.keys(served).sort());
    for (const e of index) {
      const archive = skillArchive(e.name);
      expect(e.type).toBe(archive ? "archive" : "skill-md");
      expect(e.url).toBe(`/.well-known/agent-skills/${e.name}/${archive ? "skill.zip" : "SKILL.md"}`);
      expect(e.digest).toBe(`sha256:${createHash("sha256").update(archive ?? served[e.name]).digest("hex")}`);
      expect(e.description.length).toBeGreaterThan(20);
    }
    expect(index.filter((e) => e.type === "archive").map((e) => e.name)).toEqual(["queue-pilot-fill-week"]);
  });
});

describe("skill descriptions", () => {
  it("send each task to its own skill, so the general one never competes with them", () => {
    expect(SKILL_DESCRIPTION.startsWith("Use when")).toBe(true);
    expect(SKILL_DESCRIPTION.length).toBeLessThanOrEqual(1024);
    for (const name of Object.keys(PLUGIN_SKILLS)) expect(SKILL_DESCRIPTION).toContain(name);
    expect(SKILL_DESCRIPTION).not.toMatch(/^Fill /);
  });
});

