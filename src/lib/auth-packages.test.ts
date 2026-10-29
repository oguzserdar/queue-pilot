import { describe, expect, it } from "vitest";
import pkg from "../../package.json";

// Better Auth's plugin packages must stay on the same release as better-auth itself. A newer peer pulled in
// automatically (oauth-provider 1.7.12 with core 1.7.7) made @better-auth/mcp and @better-auth/cimd fail to import.
describe("Better Auth package versions", () => {
  it("pins every @better-auth package to the better-auth version", () => {
    const deps = pkg.dependencies as Record<string, string>;
    const base = deps["better-auth"];
    const family = Object.entries(deps).filter(([name]) => name.startsWith("@better-auth/"));
    expect(family.length).toBeGreaterThan(0);
    for (const [name, version] of family) expect([name, version]).toEqual([name, base]);
  });

  it("loads the MCP and CIMD plugins", async () => {
    const mcp = await import("@better-auth/mcp");
    const cimd = await import("@better-auth/cimd");
    expect(typeof mcp.mcp).toBe("function");
    expect(typeof mcp.requireMcpAuth).toBe("function");
    expect(typeof cimd.cimd).toBe("function");
  });
});
