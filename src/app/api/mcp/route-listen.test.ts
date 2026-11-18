/**
 * @fileoverview MCP route: the server says its tool and prompt lists never change, and a 2026 subscriptions/listen
 * request is refused at once. Queue Pilot sends no change notices,
 * so an open listen would only sit until the host's time limit and then be opened again.
 * Shared mocks, fakes and helpers: src/test/mcp-route-setup.ts.
 */
import { POST, rpc } from "@/test/mcp-route-setup"
import { CLIENT_CAPABILITIES_META_KEY, CLIENT_INFO_META_KEY, PROTOCOL_VERSION_META_KEY } from "@modelcontextprotocol/server"
import { describe, expect, it } from "vitest"

describe("subscriptions/listen", () => {
  it("tells a client its tool and prompt lists never change, so it has no reason to listen", async () => {
    const response = await rpc("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test", version: "1" } })
    expect(response.result.capabilities).toMatchObject({ tools: { listChanged: false }, prompts: { listChanged: false } })
  })
  it("says the same on server/discover, the request 2026 clients use to decide whether to listen", async () => {
    const res = await POST(new Request("https://app.example/api/mcp", {
      method: "POST",
      headers: {
        authorization: "Bearer person-a", "content-type": "application/json", accept: "application/json, text/event-stream",
        "mcp-protocol-version": "2026-07-28", "mcp-method": "server/discover",
      },
      body: JSON.stringify({
        jsonrpc: "2.0", id: 42, method: "server/discover",
        params: { _meta: { [PROTOCOL_VERSION_META_KEY]: "2026-07-28", [CLIENT_INFO_META_KEY]: { name: "test", version: "1" }, [CLIENT_CAPABILITIES_META_KEY]: {} } },
      }),
    }))
    const body = await res.text()
    const line = body.trim().startsWith("{") ? body : (body.split("\n").find((l) => l.startsWith("data:")) ?? "").slice(5)
    expect(JSON.parse(line).result.capabilities).toMatchObject({ tools: { listChanged: false }, prompts: { listChanged: false } })
  })
  it("refuses a listen at once instead of holding a stream open", async () => {
    const res = await POST(new Request("https://app.example/api/mcp", {
      method: "POST",
      headers: {
        authorization: "Bearer person-a", "content-type": "application/json", accept: "application/json, text/event-stream",
        "mcp-protocol-version": "2026-07-28", "mcp-method": "subscriptions/listen",
      },
      body: JSON.stringify({
        jsonrpc: "2.0", id: 41, method: "subscriptions/listen",
        params: {
          _meta: { [PROTOCOL_VERSION_META_KEY]: "2026-07-28", [CLIENT_INFO_META_KEY]: { name: "test", version: "1" }, [CLIENT_CAPABILITIES_META_KEY]: {} },
          notifications: { toolsListChanged: true },
        },
      }),
    }))
    const type = res.headers.get("content-type") ?? ""
    if (type.includes("text/event-stream")) await res.body?.cancel()
    expect(type).toContain("application/json")
    expect(await res.json()).toMatchObject({ id: 41, error: { code: -32603 } })
  })
})
