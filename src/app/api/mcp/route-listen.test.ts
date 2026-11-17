/**
 * @fileoverview MCP route: a 2026 subscriptions/listen request is refused at once. Queue Pilot sends no change notices,
 * so an open listen would only sit until the host's time limit and then be opened again.
 * Shared mocks, fakes and helpers: src/test/mcp-route-setup.ts.
 */
import { POST } from "@/test/mcp-route-setup"
import { CLIENT_CAPABILITIES_META_KEY, CLIENT_INFO_META_KEY, PROTOCOL_VERSION_META_KEY } from "@modelcontextprotocol/server"
import { describe, expect, it } from "vitest"

describe("subscriptions/listen", () => {
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
