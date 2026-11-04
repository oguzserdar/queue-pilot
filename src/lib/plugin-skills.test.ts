/**
 * @fileoverview The skills served at /.well-known/agent-skills are the plugin's own files: editing a plugin skill
 * without running scripts/sync-plugin-skills.mjs fails here, so the install routes cannot drift apart.
 */
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { render } from "../../scripts/sync-plugin-skills.mjs";
import { PLUGIN_SKILLS } from "./plugin-skills";

describe("plugin skills", () => {
  it("matches plugin/skills exactly", () => {
    expect(readFileSync("src/lib/plugin-skills.ts", "utf8")).toBe(render());
  });

  it("serves every plugin skill folder, named after its folder", () => {
    const folders = readdirSync("plugin/skills", { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
    expect(Object.keys(PLUGIN_SKILLS).sort()).toEqual(folders);
    for (const [name, text] of Object.entries(PLUGIN_SKILLS)) expect(text).toMatch(new RegExp(`^---\\nname: ${name}\\ndescription: .+\\n(?:.*\\n)*?---\\n`));
  });
});
