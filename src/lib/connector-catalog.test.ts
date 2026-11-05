/**
 * @fileoverview Connect your AI lists every connector tool exactly once, so the page can't fall behind the connector.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CONNECTOR_CATALOG } from "./connector-catalog";

describe("connector catalog", () => {
  it("places every registered tool in exactly one group, and names no tool that doesn't exist", () => {
    // Every module that registers connector tools; mcp-content-items.ts holds the content-item tools.
    const source = ["../app/api/mcp/route.ts", "mcp-controls.ts", "mcp-content-items.ts"].map((f) => readFileSync(join(__dirname, f), "utf8")).join("\n");
    const registered = [...source.matchAll(/registerTool\(\s*"([a-z_]+)"/g)].map((m) => m[1]).sort();
    // Control: the content-item module is really scanned.
    expect(registered).toContain("promote_to_draft_posts");
    expect(registered.length).toBeGreaterThan(30);
    const listed = CONNECTOR_CATALOG.flatMap((g) => g.items.flatMap((i) => i.tools));
    expect(new Set(listed).size).toBe(listed.length);
    expect([...listed].sort()).toEqual(registered);
  });
  it("puts scheduling and deleting under the group that needs a yes", () => {
    const asks = CONNECTOR_CATALOG.find((g) => g.key === "asks")!.items.flatMap((i) => i.tools);
    expect(asks).toEqual(expect.arrayContaining(["approve_drafts", "delete_draft"]));
  });
});
