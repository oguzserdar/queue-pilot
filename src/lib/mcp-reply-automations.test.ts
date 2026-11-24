/**
 * @fileoverview The reply-automation tools on a real MCP server and the migrated database:
 * - list, save, delete and try, each with typed results, scoped to the person's own accounts
 * - saving one that is on needs the person's "act without asking" setting; switching off and deleting never do
 * - try matches a sample comment and shows the reply, without drafting with the AI or sending anything
 */
import { McpServer, createMcpHandler } from "@modelcontextprotocol/server";
import { migratedPglite } from "@/test/migrated-pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { guardServer } from "./mcp-guard";

vi.mock("server-only", () => ({}));
vi.stubEnv("DATABASE_URL", "postgres://test@localhost/unused");
const pg = await migratedPglite();
const testDb = drizzle(pg, { schema: { ...(await import("@/db/schema")), ...(await import("@/db/auth-schema")) } });
vi.mock("@/db", () => ({ db: () => testDb }));
const permission = vi.hoisted(() => ({ mode: "direct" as "ask" | "direct" | "off" }));
vi.mock("./agent-permission", () => ({ approveMode: async () => permission.mode }));
const { registerReplyAutomationTools } = await import("./mcp-reply-automations");

let serial = 0;
async function rpc(userId: string, method: string, params: Record<string, unknown>) {
  const handler = createMcpHandler(() => {
    const server = new McpServer({ name: "test", version: "1.0.0" });
    guardServer(server, { userId: userId, websiteUrl: "https://qp.example.com" });
    registerReplyAutomationTools(server, userId);
    return server;
  }, { legacy: "stateless" });
  const res = await handler.fetch(new Request("https://app.example/api/mcp", {
    method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++serial, method, params }),
  }));
  const body = await res.text();
  return JSON.parse(body.trim().startsWith("{") ? body : body.split("\n").find((line) => line.startsWith("data:"))!.slice(5));
}
/** Tools that answered at least once without an error and with typed data, which the SDK checked against their schema. */
const typedSuccess = new Set<string>();
const call = async (userId: string, name: string, args: Record<string, unknown>) => {
  const json = await rpc(userId, "tools/call", { name, arguments: args });
  if (!json.error && !json.result?.isError && json.result?.structuredContent) typedSuccess.add(name);
  return json;
};

const guide = { account_id: "acc-ada", name: "Guide", post: { scope: "any" }, keywords: ["guide"], reply_mode: "fixed", reply_texts: ["Sent you the guide!"], link: "https://ada.example/guide" };

beforeEach(async () => {
  permission.mode = "direct";
  await pg.query(`delete from qp_reply_automation`);
  await pg.query(`delete from qp_social_account`);
  await pg.query(`delete from "user" where id in ('mcp-ada', 'mcp-bob')`);
  await pg.query(`insert into "user" (id, name, email) values ('mcp-ada', 'Ada', 'ada@mcp.example'), ('mcp-bob', 'Bob', 'bob@mcp.example')`);
  await pg.query(`insert into qp_social_account (id, user_id, network, account_id, handle, server, credentials) values
    ('acc-ada', 'mcp-ada', 'mastodon', '1', '@ada@m.example', 'https://m.example', 'x'),
    ('acc-bob', 'mcp-bob', 'mastodon', '2', '@bob@m.example', 'https://m.example', 'x')`);
});
afterAll(async () => { await pg.close(); });

describe("reply automation tools", () => {
  it("lists four tools, each with a typed result", async () => {
    const tools = (await rpc("mcp-ada", "tools/list", {})).result.tools as { name: string; outputSchema?: { type: string } }[];
    expect(tools.map((t) => t.name).sort()).toEqual(["delete_reply_automation", "list_reply_automations", "save_reply_automation", "try_reply_automation"]);
    for (const t of tools) expect(t.outputSchema?.type).toBe("object");
  });

  it("saves, lists and deletes only on the person's own accounts", async () => {
    const saved = (await call("mcp-ada", "save_reply_automation", guide)).result;
    expect(saved.isError).toBeFalsy();
    const id = saved.structuredContent.id as string;
    expect((await call("mcp-ada", "list_reply_automations", {})).result.structuredContent.automations).toMatchObject([{ id, account_id: "acc-ada", keywords: ["guide"], active: true }]);
    expect((await call("mcp-bob", "list_reply_automations", {})).result.structuredContent.automations).toEqual([]);
    expect((await call("mcp-bob", "save_reply_automation", { ...guide, account_id: "acc-ada" })).result.isError).toBe(true);
    expect((await call("mcp-bob", "delete_reply_automation", { id })).result.isError).toBe(true);
    expect((await call("mcp-ada", "delete_reply_automation", { id })).result.structuredContent).toEqual({ id, deleted: true });
  });

  it("lets an AI app save one that is on only when the person let their AI act without asking; off and delete always work", async () => {
    permission.mode = "ask";
    expect((await call("mcp-ada", "save_reply_automation", guide)).result.isError).toBe(true);
    const off = (await call("mcp-ada", "save_reply_automation", { ...guide, active: false })).result;
    expect(off.isError).toBeFalsy();
    expect((await call("mcp-ada", "delete_reply_automation", { id: off.structuredContent.id })).result.isError).toBeFalsy();
  });

  it("tries a sample comment: shows which automation answers and the reply, sending nothing", async () => {
    await call("mcp-ada", "save_reply_automation", guide);
    const hit = (await call("mcp-ada", "try_reply_automation", { account_id: "acc-ada", comment: "Can I get the GUIDE?" })).result.structuredContent;
    expect(hit).toMatchObject({ answered: true, automation_name: "Guide", reply: "Sent you the guide! https://ada.example/guide" });
    const miss = (await call("mcp-ada", "try_reply_automation", { account_id: "acc-ada", comment: "nice post" })).result.structuredContent;
    expect(miss).toMatchObject({ answered: false });
    expect((await pg.query(`select count(*)::int as n from qp_message`)).rows[0]).toEqual({ n: 0 });
  });

  it("under ask-first, refuses to remove the last automation of an account with replies on, since that would answer every mention", async () => {
    const id = (await call("mcp-ada", "save_reply_automation", guide)).result.structuredContent.id as string;
    await pg.query(`update qp_social_account set replies_on = true where id = 'acc-ada'`);
    permission.mode = "ask";
    expect((await call("mcp-ada", "delete_reply_automation", { id })).result.isError).toBe(true);
    expect((await call("mcp-ada", "save_reply_automation", { ...guide, id, active: false })).result.isError).toBe(true);
    permission.mode = "direct";
    expect((await call("mcp-ada", "delete_reply_automation", { id })).result.isError).toBeFalsy();
  });
});

describe("typed results proven for every tool here", () => {
  it("every tool returned typed data on a successful call", () => {
    expect([...typedSuccess].sort()).toEqual(["delete_reply_automation", "list_reply_automations", "save_reply_automation", "try_reply_automation"]);
  });
});
