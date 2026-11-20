/**
 * @fileoverview The person's social-account tools on a real MCP server and the migrated database:
 * - tools/list shows list_social_accounts (read-only) and set_replies with their schemas and hints
 * - list_social_accounts shows the person's own accounts and never a credential
 * - set_replies switches only the account named, and refuses another person's account id as unknown
 */
import { McpServer, createMcpHandler } from "@modelcontextprotocol/server";
import { encryptSecret } from "@/lib/secrets";
import { migratedPglite } from "@/test/migrated-pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { guardServer } from "./mcp-guard";

const master = "78".repeat(32);
vi.stubEnv("DATABASE_URL", "postgres://test@localhost/unused");
vi.stubEnv("SETTINGS_KEY", master);
const pg = await migratedPglite();
const testDb = drizzle(pg, { schema: { ...(await import("@/db/schema")), ...(await import("@/db/auth-schema")) } });
vi.mock("@/db", () => ({ db: () => testDb }));
const permission = vi.hoisted(() => ({ mode: "direct" as "ask" | "direct" | "off" }));
vi.mock("./agent-permission", () => ({ approveMode: async () => permission.mode }));
const { registerSocialAccountTools } = await import("./mcp-social-accounts");

let serial = 0;
async function rpc(userId: string, method: string, params: Record<string, unknown>) {
  const handler = createMcpHandler(() => {
    const server = new McpServer({ name: "test", version: "1.0.0" });
    guardServer(server, { userId: userId, websiteUrl: "https://qp.example.com" });
    registerSocialAccountTools(server, userId);
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
const repliesOf = async (id: string) => (await pg.query<{ replies_on: boolean }>(`select replies_on from qp_social_account where id = $1`, [id])).rows[0].replies_on;

beforeEach(async () => {
  permission.mode = "direct";
  await pg.query(`delete from qp_social_account`);
  await pg.query(`delete from "user" where id in ('mcp-ada', 'mcp-bob')`);
  await pg.query(`insert into "user" (id, name, email) values ('mcp-ada', 'Ada', 'ada@mcp.example'), ('mcp-bob', 'Bob', 'bob@mcp.example')`);
  const creds = encryptSecret(JSON.stringify({ token: "secret-token-ada" }), master);
  await pg.query(
    `insert into qp_social_account (id, user_id, network, account_id, handle, server, credentials) values
     ('acc-ada-m', 'mcp-ada', 'mastodon', '1', '@ada@m.example', 'https://m.example', $1),
     ('acc-ada-b', 'mcp-ada', 'bluesky', 'did:plc:ada', 'ada.bsky.social', 'https://pds.example', $1),
     ('acc-bob-m', 'mcp-bob', 'mastodon', '2', '@bob@m.example', 'https://m.example', $1)`,
    [creds],
  );
});

afterAll(async () => {
  try {
    await pg.close();
  } finally {
    vi.unstubAllEnvs();
  }
});

describe("social-account tools on a real MCP server", () => {
  it("lists both tools with their schemas and hints", async () => {
    const json = await rpc("mcp-ada", "tools/list", {});
    expect(json.error).toBeUndefined();
    const tools = json.result.tools as { name: string; description: string; inputSchema: { properties?: Record<string, unknown>; required?: string[] }; annotations: Record<string, boolean> }[];
    expect(tools.map((t) => t.name).sort()).toEqual(["list_social_accounts", "set_replies"]);
    const list = tools.find((t) => t.name === "list_social_accounts")!;
    expect(list.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
    const set = tools.find((t) => t.name === "set_replies")!;
    expect(set.inputSchema.required?.sort()).toEqual(["account_id", "on"]);
    expect(set.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false, idempotentHint: true });
    expect(set.description).toMatch(/inbox/);
  });

  it("lists only the person's own accounts, without credentials", async () => {
    const json = await call("mcp-ada", "list_social_accounts", {});
    const out = json.result.content[0].text as string;
    expect(json.result.isError).toBeFalsy();
    expect(out).toContain("acc-ada-m");
    expect(out).toContain("ada.bsky.social");
    expect(out).not.toContain("acc-bob-m");
    expect(out).not.toContain("secret-token-ada");
    expect(out).not.toMatch(/v1:/);
  });

  it("switches replies on only the account named", async () => {
    const json = await call("mcp-ada", "set_replies", { account_id: "acc-ada-m", on: true });
    expect(json.result.isError).toBeFalsy();
    expect(await repliesOf("acc-ada-m")).toBe(true);
    expect(await repliesOf("acc-ada-b")).toBe(false);
    expect(await repliesOf("acc-bob-m")).toBe(false);
  });

  it("refuses another person's account id as unknown and changes nothing", async () => {
    const json = await call("mcp-ada", "set_replies", { account_id: "acc-bob-m", on: true });
    expect(json.result.isError).toBe(true);
    expect(json.result.content[0].text).toMatch(/list_social_accounts/);
    expect(await repliesOf("acc-bob-m")).toBe(false);
  });

  it("will not turn replies on unless the person lets their AI act without asking, and says to use Settings", async () => {
    for (const mode of ["ask", "off"] as const) {
      permission.mode = mode;
      const json = await call("mcp-ada", "set_replies", { account_id: "acc-ada-m", on: true });
      expect(json.result.isError).toBe(true);
      expect(json.result.content[0].text).toMatch(/Settings/);
      expect(await repliesOf("acc-ada-m")).toBe(false);
    }
  });

  it("always lets an AI app turn replies off", async () => {
    await pg.query(`update qp_social_account set replies_on = true where id = 'acc-ada-m'`);
    permission.mode = "off";
    const json = await call("mcp-ada", "set_replies", { account_id: "acc-ada-m", on: false });
    expect(json.result.isError).toBeFalsy();
    expect(await repliesOf("acc-ada-m")).toBe(false);
  });

  it("advertises typed results and returns them as structured content as well as text", async () => {
    const list = (await rpc("mcp-ada", "tools/list", {})).result.tools as { name: string; outputSchema?: { type: string; properties: Record<string, unknown> } }[];
    for (const t of list) expect(t.outputSchema?.type).toBe("object");
    const json = await call("mcp-ada", "list_social_accounts", {});
    const sc = json.result.structuredContent as { accounts: { id: string; network: string; replies_on: boolean }[] };
    expect(sc.accounts.map((a) => a.id).sort()).toEqual(["acc-ada-b", "acc-ada-m"]);
    expect(JSON.stringify(sc)).not.toContain("secret-token-ada");
    const set = await call("mcp-ada", "set_replies", { account_id: "acc-ada-m", on: true });
    expect(set.result.structuredContent).toEqual({ account_id: "acc-ada-m", replies_on: true });
  });
});

describe("typed results proven for every tool here", () => {
  it("every tool returned typed data on a successful call", () => {
    expect([...typedSuccess].sort()).toEqual(["list_social_accounts", "set_replies"]);
  });
});
