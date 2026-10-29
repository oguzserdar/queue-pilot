import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { Channel, Post } from "@/lib/buffer/queries"
import type { Written } from "@/lib/written-store"
import type { Rule } from "@/lib/rules"
import { fakeBuffer } from "@/test/fake-buffer"
import { answering, deciding } from "@/lib/ai-test-model"

vi.mock("@/db", () => ({ db: () => { throw new Error("Unexpected database call") } }))
vi.mock("@/lib/auth", () => ({ getAuth: async () => ({ $context: Promise.resolve({ baseURL: "https://app.example/api/auth" }) }), mcpResource: (url: string) => `${url}/api/mcp` }))
vi.mock("@better-auth/mcp", () => ({
  requireMcpAuth: (_auth: unknown, handler: (req: Request, claims: { sub?: string, azp: string }) => Promise<Response>) => (req: Request) => {
    const sub = req.headers.get("authorization")?.replace("Bearer ", "")
    return sub ? handler(req, { sub, azp: "test-client" }) : new Response("Unauthorized", { status: 401 })
  },
}))
vi.mock("@/lib/ai-access", () => ({ stillApproved: async () => true, recordAppUse: async () => {} }))
vi.mock("@/lib/rate-limit", () => ({ limit: async () => ({ ok: true }), limitHeaders: () => ({}) }))
vi.mock("@/lib/buffer-token", () => ({ bufferAccessToken: async (_auth: unknown, userId: string) => userId }))
vi.mock("@/lib/buffer/snapshot-store", () => ({ postgresSnapshotStore: () => snapshots }))
vi.mock("@/lib/voice-store", async (original) => ({ ...await original<typeof import("@/lib/voice-store")>(), postgresVoiceStore: () => voices }))
vi.mock("@/lib/sources-store", async (original) => ({ ...await original<typeof import("@/lib/sources-store")>(), postgresSourceStore: () => sources }))
vi.mock("@/lib/material-store", async (original) => ({ ...await original<typeof import("@/lib/material-store")>(), postgresMaterialStore: () => material }))
vi.mock("@/lib/rules-store", () => ({ postgresRulesStore: () => ({ list: async (id: string) => rules.get(id) ?? [] }) }))
vi.mock("@/lib/written-store", () => ({
  postgresWrittenStore: () => ({ record: async (id: string, drafts: Written[]) => written.set(id, [...(written.get(id) ?? []), ...drafts]) }),
  wroteIds: async (id: string, ...ids: string[]) => new Set((written.get(id) ?? []).filter((p) => ids.includes(p.postId)).map((p) => p.postId)),
}))
vi.mock("@/lib/buffer/client", async (original) => ({ ...await original<typeof import("@/lib/buffer/client")>(), bufferQuery: (...args: unknown[]) => buffer.q(...args) }))
vi.mock("@/lib/safe-fetch", () => ({ safeFetch: vi.fn(), BlockedAddressError: class extends Error {} }))
vi.mock("@/lib/judge-model", () => ({ AiCapError: class extends Error {}, judgeModelFor: async () => ({
  judges: { decider: judge.model, explainer: answering({ quote: "broth", reason: "Use stock." }) },
  source: "your key", settle: async () => {},
}) }))

const { memoryVoiceStore, MAX_EXAMPLES, MAX_NOTE, MAX_PASTED_TEXT } = await import("@/lib/voice-store")
const { memorySourceStore } = await import("@/lib/sources-store")
const { memoryMaterialStore } = await import("@/lib/material-store")
const { memorySnapshotStore } = await import("@/lib/buffer/snapshot")
const { safeFetch } = await import("@/lib/safe-fetch")
const { POST } = await import("./route")
const { newMaterial } = await import("@/lib/new-material")
let voices = memoryVoiceStore()
let sources = memorySourceStore()
let material = memoryMaterialStore()
let snapshots = memorySnapshotStore()
const written = new Map<string, Written[]>()
const rules = new Map<string, Rule[]>()
let posts: Post[] = []
let serial = 0
const channel: Channel = { id: "ch", name: "My channel", service: "linkedin", organizationId: "org", timezone: "UTC", isDisconnected: false, isLocked: false, isQueuePaused: false, postingSchedule: [{ day: "mon", paused: false, times: ["09:00", "12:00"] }] }
const judge = deciding((ids, state) => Object.fromEntries(ids.map((id) => [id, { type: "choice", choice: state.includes("broth") ? "fail" : "pass" }])))
const buffer = fakeBuffer((call) => {
  const { query, variables } = call
  if (query.includes("{ account")) return { account: { email: "a@example.com", timezone: "UTC", organizations: [{ id: "org" }] } }
  if (query.includes("channels(input")) return { channels: [channel] }
  if (query.includes("posts(input")) return { posts: { edges: structuredClone(posts).map((node) => ({ node })), pageInfo: { hasNextPage: false } } }
  if (query.includes("createContentItem")) {
    const added: Post[] = variables.input.posts.map((p: { text: string, dueAt: string, saveToDraft: boolean }) => {
      expect(p.saveToDraft).toBe(true)
      return { id: `post-${++serial}`, channelId: channel.id, text: p.text, dueAt: p.dueAt, status: "draft", via: "api", sentAt: null, externalLink: null, error: null }
    })
    posts.push(...added)
    return { createContentItem: { __typename: "CreateContentItemSuccess", content: { body: { posts: added } } } }
  }
  if (query.includes("editPost")) {
    expect(variables.input.saveToDraft).toBe(true)
    posts = posts.map((p) => p.id === variables.input.id ? { ...p, text: variables.input.text } : p)
    return { editPost: { __typename: "PostActionSuccess" } }
  }
  if (query.includes("deletePost")) {
    posts = posts.filter((p) => p.id !== variables.input.id)
    return { deletePost: { __typename: "DeletePostSuccess" } }
  }
  throw new Error("Unexpected Buffer query")
})

const releaseXml = `<feed xmlns="http://www.w3.org/2005/Atom"><title>Releases</title><id>releases</id><updated>2026-10-29T12:00:00Z</updated><entry><id>v2</id><title>v2</title><updated>2026-10-29T12:00:00Z</updated><link href="https://example.com/releases/v2"/><content type="html">&lt;p&gt;CSV export is live. Includes archived rows.&lt;/p&gt;</content></entry></feed>`
type Result = { content: { type: string, text: string }[], isError?: boolean }
async function rpc(method: string, params: Record<string, unknown>, userId = "person-a") {
  const res = await POST(new Request("https://app.example/api/mcp", {
    method: "POST", headers: { authorization: `Bearer ${userId}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++serial, method, params }),
  }))
  const body = await res.text()
  const json = JSON.parse(body.trim().startsWith("{") ? body : body.split("\n").find((line) => line.startsWith("data:"))!.slice(5))
  return json
}
async function call(name: string, args: Record<string, unknown> = {}, userId = "person-a"): Promise<Result> {
  const json = await rpc("tools/call", { name, arguments: args }, userId)
  return json.error ? { isError: true, content: [{ type: "text", text: JSON.stringify(json.error) }] } : json.result
}
const answer = (r: Result) => r.content.map((c) => c.text).join("\n")

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(new Date("2026-10-29T12:00:00Z"))
  voices = memoryVoiceStore()
  sources = memorySourceStore()
  material = memoryMaterialStore()
  snapshots = memorySnapshotStore()
  written.clear()
  rules.clear()
  posts = []
  buffer.calls.length = 0
  buffer.limitCalls.length = 0
  vi.mocked(safeFetch).mockImplementation(async () => new Response(releaseXml))
})
afterEach(() => { vi.useRealTimers() })

describe("connector voice writes", () => {
  it("lists all tools with serializable input schemas", async () => {
    const response = await rpc("tools/list", {})
    expect(response.error).toBeUndefined()
    const tools = response.result.tools
    expect(tools).toHaveLength(14)
    expect(tools.find((t: { name: string }) => t.name === "add_voice_example").inputSchema.properties.text.maxLength).toBe(MAX_PASTED_TEXT)
    expect(tools.find((t: { name: string }) => t.name === "save_my_voice_note").inputSchema.properties.note.maxLength).toBe(MAX_NOTE)
  })

  it("saves, reads and clears notes only for the token's person", async () => {
    expect(answer(await call("save_my_voice_note", { note: "Short and plain", userId: "person-b" }))).toContain("saved")
    expect(answer(await call("get_my_voice"))).toContain("Short and plain")
    expect(answer(await call("get_my_voice", {}, "person-b"))).toContain("No voice set")
    expect((await call("save_my_voice_note", { note: "x".repeat(MAX_NOTE + 1) })).isError).toBe(true)
    expect((await voices.get("person-a")).note).toBe("Short and plain")
    expect((await call("save_my_voice_note", { note: "x".repeat(MAX_NOTE) })).isError).not.toBe(true)
    await call("save_my_voice_note", { note: "" })
    expect((await voices.get("person-a")).note).toBeNull()
  })

  it("saves pasted posts and refuses blank, long or excess examples", async () => {
    expect((await call("add_voice_example", { text: "x".repeat(MAX_PASTED_TEXT + 1) })).isError).toBe(true)
    expect((await call("add_voice_example", { text: "\u200b " })).isError).toBe(true)
    expect((await call("add_voice_example", { text: "x".repeat(MAX_PASTED_TEXT), userId: "person-b" })).isError).not.toBe(true)
    for (let i = 1; i < MAX_EXAMPLES; i++) await call("add_voice_example", { text: `My post ${i}` })
    expect(answer(await call("get_my_voice"))).toContain('channel="Pasted"')
    expect((await voices.get("person-b")).examples).toEqual([])
    const result = await call("add_voice_example", { text: "one more" })
    expect(result.isError).toBe(true)
    expect(answer(result)).toContain("Remove one")
  })

  it.each(["save_my_voice_note", "add_voice_example", "add_material"])("hides private failures from %s", async (name) => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {})
    const fail = new Error("private person-a storage failure")
    vi.spyOn(voices, "setNote").mockRejectedValue(fail)
    vi.spyOn(voices, "addExample").mockRejectedValue(fail)
    vi.spyOn(material, "add").mockRejectedValue(fail)
    const result = await call(name, { note: "short", text: "My writing", title: "Notes" })
    expect(result.isError).toBe(true)
    expect(answer(result)).toBe("Could not save that just now. Try again in a minute.")
    log.mockRestore()
  })

  it("rejects signed-out requests before a tool writes", async () => {
    const res = await POST(new Request("https://app.example/api/mcp", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "add_voice_example", arguments: { text: "My post" } } }) }))
    expect(res.status).toBe(401)
    expect((await voices.get("person-a")).examples).toEqual([])
  })
})

describe("connector draft chain", () => {
  it("reads release text, learns voice, checks rules, saves, shows, edits and deletes its own drafts", async () => {
    rules.set("person-a", [{ id: "stock", kind: "replace", from: "broth", to: "stock", channels: "all", level: "block", text: "Say stock instead of broth." }])
    expect((await call("add_source", { url: "https://github.com/example/app/releases" })).isError).not.toBe(true)
    expect(String(vi.mocked(safeFetch).mock.calls[0][0])).toBe("https://github.com/example/app/releases.atom")
    const listed = answer(await call("list_new_material"))
    const key = listed.match(/key: (.+)/)![1]
    expect(answer(await call("read_material", { key }))).toContain("CSV export is live. Includes archived rows.")
    expect((await call("read_material", { key }, "person-b")).isError).toBe(true)
    await call("save_my_voice_note", { note: "Short and plain" })
    await call("add_voice_example", { text: "Shipped it. Here is what changed." })
    expect(answer(await call("get_my_voice"))).toContain("Shipped it")
    expect(answer(await call("get_playbook"))).toContain("enforced")
    const slotId = answer(await call("list_open_slots")).match(/ch@[^ ]+/)![0]
    const rejected = await call("save_drafts", { title: "Release", drafts: [{ slotId, text: "broth export" }] })
    expect(rejected.isError).toBe(true)
    expect(answer(rejected)).toContain("Breaks your playbook")
    expect(posts).toHaveLength(0)
    const saved = await call("save_drafts", { title: "Release", drafts: [{ slotId, text: "CSV export is live." }], sourceKeys: [key] })
    expect(saved.isError).not.toBe(true)
    expect(answer(saved)).toContain("1 saved")
    expect(answer(saved)).toContain("Checked against")
    expect(posts).toHaveLength(1)
    const postId = posts[0].id
    const shown = answer(await call("show_next_week"))
    expect(shown).toContain(`post id ${postId}`)
    expect(shown).toContain("CSV export is live.")
    expect(answer(await call("list_new_material"))).not.toContain(`key: ${key}`)
    expect((await call("save_drafts", { title: "Repeat", drafts: [{ slotId, text: "again" }] })).isError).toBe(true)
    expect((await call("update_draft", { postId, text: "broth" })).isError).toBe(true)
    expect((await call("update_draft", { postId, text: "CSV export includes archived rows." })).isError).not.toBe(true)
    expect(answer(await call("show_next_week"))).toContain("includes archived rows")
    expect((await call("delete_draft", { postId })).isError).not.toBe(true)
    expect(answer(await call("show_next_week"))).not.toContain(`post id ${postId}`)
    expect(answer(await call("list_open_slots"))).toContain(slotId)
    expect(posts).toHaveLength(0)
  })

  it("refuses other apps' drafts and scheduled posts for both changes", async () => {
    posts = [{ id: "foreign", channelId: "ch", status: "draft", via: "api", text: "Someone else's draft", dueAt: "2026-11-02T09:00:00.000Z", sentAt: null, externalLink: null, error: null }]
    for (const name of ["update_draft", "delete_draft"]) {
      expect((await call(name, { postId: "foreign", text: "replace" })).isError).toBe(true)
    }
    written.set("person-a", [{ postId: "foreign", network: "linkedin", text: "Original" }])
    posts[0].status = "scheduled"
    vi.setSystemTime(new Date("2026-10-29T12:01:00Z"))
    for (const name of ["update_draft", "delete_draft"]) {
      expect((await call(name, { postId: "foreign", text: "replace" })).isError).toBe(true)
      expect((await call(name, { postId: "foreign", text: "replace" }, "person-b")).isError).toBe(true)
    }
    expect(buffer.calls.filter((c) => /editPost|deletePost/.test(c.query))).toHaveLength(0)
  })

  it("keeps raw research private and makes it available to both writers", async () => {
    const input = { title: "Release notes", text: "CSV export includes archived rows.", link: "https://example.com/release" }
    const added = answer(await call("add_material", input))
    const key = added.match(/key: (.+)/)![1]
    expect(answer(await call("add_material", input))).toBe(added)
    expect(answer(await call("list_new_material"))).toContain(key)
    expect(answer(await call("read_material", { key }))).toContain(input.text)
    expect((await call("read_material", { key }, "person-b")).isError).toBe(true)
    expect(answer(await call("list_new_material", {}, "person-b"))).not.toContain(key)
    expect(await newMaterial("person-a")).toEqual([{ key, title: input.title, text: input.text, url: input.link }])
    const slotId = answer(await call("list_open_slots")).match(/ch@[^ ]+/)![0]
    await call("save_drafts", { title: input.title, drafts: [{ slotId, text: input.text }], sourceKeys: [key] })
    expect(answer(await call("list_new_material"))).not.toContain(key)
    expect(await newMaterial("person-a")).toEqual([])
    for (const bad of [{ ...input, text: "x".repeat(12_001) }, { ...input, title: " " }, { ...input, link: "file:///private/data" }]) {
      expect((await call("add_material", bad)).isError).toBe(true)
    }
  })
})
