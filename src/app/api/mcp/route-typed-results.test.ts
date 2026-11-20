/**
 * @fileoverview Every MCP tool is proven to return typed data that passed its schema. Each tool has one owner in
 * src/test/mcp-tool-owners.ts: a route-*.test.ts file, which proves it on a real call in its "typed results proven in
 * this file" test, or another file that proves it on a real MCP server. This checks that the owners list every tool the
 * route serves, each exactly once, so a new tool without an owner fails here.
 * Shared mocks, fakes and helpers: src/test/mcp-route-setup.ts and src/test/fake-buffer-api.ts.
 */
import { rpc } from "@/test/mcp-route-setup"
import { PROVEN_ELSEWHERE, TOOL_OWNERS } from "@/test/mcp-tool-owners"
import { describe, expect, it } from "vitest"

describe("typed results proven for every tool", () => {
  it("every tool returned typed data on a successful call", async () => {
    const tools = ((await rpc("tools/list", {})).result.tools as { name: string }[]).map((t) => t.name)
    const owned = [...Object.values(TOOL_OWNERS), ...Object.values(PROVEN_ELSEWHERE)].flat()
    const twice = owned.filter((t, i) => owned.indexOf(t) !== i)
    const missing = tools.filter((t) => !owned.includes(t)).sort()
    console.log(`typed success: ${tools.length - missing.length} of ${tools.length}; missing: ${missing.join(", ")}`)
    expect({ missing, twice }).toEqual({ missing: [], twice: [] })
    expect([...owned].sort()).toEqual([...tools].sort())
  })
})
