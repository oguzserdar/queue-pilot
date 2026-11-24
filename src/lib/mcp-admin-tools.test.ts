/**
 * @fileoverview The admin tools on a real MCP server, served the way the connector serves them:
 * - tools/list shows every admin tool an AI app may run, with its input schema and hints, and no page-only operation
 * - tools/call reaches the admin door with the arguments, and a refusal comes back as an error naming the next step
 */
import { McpServer, createMcpHandler } from "@modelcontextprotocol/server";
import { describe, expect, it, vi } from "vitest";
import { guardServer } from "./mcp-guard";

const calls: { name: string; input: unknown }[] = [];
vi.mock("./admin-operations", async (orig) => {
  const real = await orig<typeof import("./admin-operations")>();
  return {
    ...real,
    invokeAdminOperation: async (_p: unknown, name: string, input: unknown) => {
      calls.push({ name, input });
      return name === "admin.settings.list" ? { ok: true, value: [{ key: "ai_cap_total", set: false }] } : { ok: false, code: "PERMISSION_DENIED", message: "This AI app has no admin access.", nextStep: real.NEXT_STEP.PERMISSION_DENIED };
    },
  };
});
const { registerAdminTools } = await import("./mcp-admin-tools");

let serial = 0;
async function rpc(method: string, params: Record<string, unknown>) {
  const handler = createMcpHandler(() => {
    const server = new McpServer({ name: "test", version: "1.0.0" });
    guardServer(server, { userId: "admin", websiteUrl: "https://qp.example.com" });
    registerAdminTools(server, { via: "mcp", userId: "admin", clientId: "client-a" });
    return server;
  }, { legacy: "stateless" });
  const res = await handler.fetch(new Request("https://app.example/api/mcp", {
    method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++serial, method, params }),
  }));
  const body = await res.text();
  return JSON.parse(body.trim().startsWith("{") ? body : body.split("\n").find((line) => line.startsWith("data:"))!.slice(5));
}

describe("admin tools on a real MCP server", () => {
  it("lists every admin tool with its schema and hints", async () => {
    const json = await rpc("tools/list", {});
    expect(json.error).toBeUndefined();
    const tools = json.result.tools as { name: string; inputSchema: { properties?: Record<string, unknown>; required?: string[] }; annotations: Record<string, boolean> }[];
    expect(tools.map((t) => t.name).sort()).toEqual(["admin_audit_list", "admin_failures_list", "admin_health_read", "admin_keys_test", "admin_settings_clear", "admin_settings_keep", "admin_settings_list", "admin_settings_set", "admin_usage_read", "admin_users_list"]);
    const clear = tools.find((t) => t.name === "admin_settings_clear")!;
    expect(Object.keys(clear.inputSchema.properties ?? {}).sort()).toEqual(["confirm", "key", "reason"]);
    expect(clear.annotations).toMatchObject({ destructiveHint: true, readOnlyHint: false });
  });

  // The same rules src/app/api/mcp/tool-definitions.test.ts checks in source. Admin tools are made from the operation
  // registry in a loop, so source cannot show them; this checks what the server really lists, for every admin tool.
  it("gives every admin tool a title, a description and the three hints, and never a read-only destructive one", async () => {
    const json = await rpc("tools/list", {});
    const tools = json.result.tools as { name: string; title?: string; description?: string; annotations?: Record<string, unknown> }[];
    expect(tools.length).toBeGreaterThan(5);
    const problems = tools.flatMap((t) => {
      const a = t.annotations ?? {};
      const missing = ["readOnlyHint", "destructiveHint", "openWorldHint"].filter((h) => typeof a[h] !== "boolean");
      return [
        ...(t.title ? [] : [`${t.name}: no title`]),
        ...(t.description ? [] : [`${t.name}: no description`]),
        ...missing.map((h) => `${t.name}: ${h} is not set`),
        ...(a.readOnlyHint === true && a.destructiveHint === true ? [`${t.name}: read-only and destructive`] : []),
      ];
    });
    expect(problems).toEqual([]);
  });

  it("passes a call to the door, and returns a refusal as an error with its code and next step", async () => {
    const ok = await rpc("tools/call", { name: "admin_settings_list", arguments: {} });
    expect(ok.result.isError).toBeFalsy();
    expect(ok.result.content[0].text).toContain("ai_cap_total");
    const refused = await rpc("tools/call", { name: "admin_settings_set", arguments: { key: "ai_cap_per_person", value: "12" } });
    expect(refused.result.isError).toBe(true);
    expect(refused.result.content[0].text).toMatch(/^PERMISSION_DENIED: .*Next step: /);
    expect(calls).toContainEqual({ name: "admin.settings.set", input: { key: "ai_cap_per_person", value: "12" } });
  });
});
