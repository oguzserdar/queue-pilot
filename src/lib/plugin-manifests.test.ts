/**
 * @fileoverview The plugin manifests, the marketplace entry and the app name one version, so the plugin validator
 * does not warn and an installed plugin says what is running.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => JSON.parse(readFileSync(path, "utf8"));

describe("plugin versions", () => {
  it("agree across package, both plugin manifests and the marketplace", () => {
    const version = read("package.json").version;
    expect(read("plugin/.claude-plugin/plugin.json").version).toBe(version);
    expect(read("plugin/.codex-plugin/plugin.json").version).toBe(version);
    for (const entry of read(".claude-plugin/marketplace.json").plugins) expect(entry.version).toBe(version);
  });
});

describe("marketplace entry", () => {
  it("carries the install policy and category the Codex plugin guide asks for", () => {
    for (const entry of read(".claude-plugin/marketplace.json").plugins) {
      expect(entry.policy).toEqual({ installation: "AVAILABLE", authentication: "ON_INSTALL" });
      expect(entry.category).toBe("Productivity");
    }
  });
});
