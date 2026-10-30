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
vi.mock("@/lib/ai-access", () => ({ stillApproved: async () => true, recordAppUse: async () => {}, approvedApps: async () => [{ name: "ChatGPT", lastUsedAt: "2026-10-29T12:00:00Z" }] }))
vi.mock("@/lib/rate-limit", () => ({ limit: async () => ({ ok: true }), limitHeaders: () => ({}) }))
vi.mock("@/lib/buffer-token", () => ({ bufferAccessToken: async (_auth: unknown, userId: string) => userId }))
vi.mock("@/lib/buffer/snapshot-store", () => ({ postgresSnapshotStore: () => snapshots }))
vi.mock("@/lib/voice-store", async (original) => ({ ...await original<typeof import("@/lib/voice-store")>(), postgresVoiceStore: () => voices }))
vi.mock("@/lib/sources-store", async (original) => ({ ...await original<typeof import("@/lib/sources-store")>(), postgresSourceStore: () => sources }))
vi.mock("@/lib/material-store", async (original) => ({ ...await original<typeof import("@/lib/material-store")>(), postgresMaterialStore: () => material }))
vi.mock("@/lib/rules-store", async original => ({ ...await original<typeof import("@/lib/rules-store")>(), postgresRulesStore: () => ruleStore }))
vi.mock("@/lib/written-store", () => ({
  postgresWrittenStore: () => ({ get: async (id: string, ids: string[]) => (written.get(id) ?? []).filter(w => ids.includes(w.postId)), record: async (id: string, drafts: Written[]) => written.set(id, [...(written.get(id) ?? []), ...drafts]) }),
  wroteIds: async (id: string, ...ids: string[]) => new Set((written.get(id) ?? []).filter((p) => ids.includes(p.postId)).map((p) => p.postId)),
}))
vi.mock("@/lib/buffer/client", async (original) => ({ ...await original<typeof import("@/lib/buffer/client")>(), bufferQuery: (...args: unknown[]) => buffer.q(...args) }))
vi.mock("@/lib/safe-fetch", () => ({ safeFetch: vi.fn(), BlockedAddressError: class extends Error {} }))
const aiCalls = vi.hoisted(() => ({ settle: vi.fn(async () => {}), giveBack: vi.fn(async () => {}) }));
vi.mock("@/lib/judge-model", () => ({ AiCapError: class extends Error {}, allowanceFor: async () => ({ used: 1, cap: 20, budgetUsd: 100, leftUsd: 99.95, totalRemaining: 100 }), aiFor: async () => ({ cfg: { provider: "openai", key: "never-display", model: "test" }, language: answering({ quote: "broth", reason: "Use stock." }), decider: judge.model, source: "Queue Pilot key", ...aiCalls }), judgeModelFor: async () => ({
  judges: { decider: judge.model, explainer: answering({ quote: "broth", reason: "Use stock." }) },
  source: "your key", cfg: { provider: "openai" }, ...aiCalls,
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
const dismissed = new Map<string, Set<string>>()
const ruleStore = {
  list: async (id: string) => rules.get(id) ?? [],
  add: async (id: string, rule: import("@/lib/rules").NewRule, fixes = 0) => { const key = `rule-${++serial}`; rules.set(id, [...(rules.get(id) ?? []), { ...rule, id: key, fixes } as Rule & { fixes: number }]); return key },
  remove: async (id: string, key: string) => { rules.set(id, (rules.get(id) ?? []).filter(r => r.id !== key)) },
  dismissed: async (id: string) => dismissed.get(id) ?? new Set<string>(),
  dismiss: async (id: string, key: string) => { const mine = dismissed.get(id) ?? new Set<string>(); mine.add(key); dismissed.set(id, mine) },
}
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
  dismissed.clear()
  aiCalls.settle.mockClear()
  aiCalls.giveBack.mockClear()
  vi.stubEnv("SESSION_SECRET", "test-only-signing-key")
  posts = []
  buffer.calls.length = 0
  buffer.limitCalls.length = 0
  vi.mocked(safeFetch).mockImplementation(async () => new Response(releaseXml))
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs() })

describe("connector voice writes", () => {
  it("returns the product name, website and logo during connector initialization", async () => {
    const response = await rpc("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test", version: "1" } });
    expect(response.error).toBeUndefined();
    expect(response.result.serverInfo).toMatchObject({
      name: "queue-pilot", title: "Queue Pilot", websiteUrl: "https://app.example",
      icons: [{ src: "https://app.example/icon-512.png", mimeType: "image/png", sizes: ["512x512"] }],
    });
  });
  it("lists all tools with serializable input schemas", async () => {
    const response = await rpc("tools/list", {})
    expect(response.error).toBeUndefined()
    const tools = response.result.tools
    expect(tools).toHaveLength(31)
    expect(tools.map((t: { name: string }) => t.name)).not.toEqual(expect.arrayContaining(["approve", "schedule", "delete_account", "save_ai_key"]))
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

  it("removes only the requested example owned by the token's person", async () => {
    await voices.setNote("person-a", "Keep this note")
    await voices.addExample("person-a", { postId: "a-1", channel: "Pasted", text: "First" })
    await voices.addExample("person-a", { postId: "a-2", channel: "Pasted", text: "Second" })
    await voices.addExample("person-b", { postId: "b-1", channel: "Pasted", text: "Private" })
    expect(answer(await call("get_my_voice"))).toContain('Example ID: "a-1"')
    expect(answer(await call("get_my_voice"))).not.toContain("b-1")
    await call("remove_voice_example", { exampleId: "b-1", userId: "person-b" })
    expect((await voices.get("person-b")).examples).toHaveLength(1)
    expect(answer(await call("remove_voice_example", { exampleId: "a-1" }))).toContain("removed")
    expect(await voices.get("person-a")).toEqual({ note: "Keep this note", examples: [{ postId: "a-2", channel: "Pasted", text: "Second" }] })
    await call("remove_voice_example", { exampleId: "a-1" })
    expect((await voices.get("person-a")).examples).toHaveLength(1)
    expect(buffer.calls).toHaveLength(0)
  })

  it("hides storage failures when removing a writing example", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {})
    await voices.addExample("person-a", { postId: "a-1", channel: "Pasted", text: "First" })
    vi.spyOn(voices, "removeExample").mockRejectedValue(new Error("private person-a SQL failure"))
    const result = await call("remove_voice_example", { exampleId: "a-1" })
    expect(result.isError).toBe(true)
    expect(answer(result)).toBe("Could not remove that example just now. Try again in a minute.")
    log.mockRestore()
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
    expect(rejected.isError).not.toBe(true)
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

describe("connector controls", () => {
  it("adds a validated rule, exposes its ID, and rejects cross-user reads and removal", async () => {
    const input = { kind: "replace", from: "broth", to: "stock", channels: ["linkedin"], level: "block", userId: "person-b" };
    const added = JSON.parse(answer(await call("add_rule", input)));
    expect(added.id).toBeTruthy();
    expect(answer(await call("get_playbook"))).toContain(added.id);
    expect((await call("read_rule", { id: added.id }, "person-b")).isError).toBe(true);
    expect((await call("remove_rule", { id: added.id }, "person-b")).isError).toBe(true);
    expect(rules.get("person-a")).toHaveLength(1);
    expect((await call("add_rule", { ...input, channels: ["not-a-network"] })).isError).toBe(true);
    expect((await call("add_rule", { ...input, from: "" })).isError).toBe(true);
    await call("remove_rule", { id: added.id });
    expect(rules.get("person-a")).toHaveLength(0);
  });
  it("checks refusal, correction and warning without writing a Buffer post", async () => {
    rules.set("person-a", [{ id: "stock", kind: "replace", from: "broth", to: "stock", channels: "all", level: "block", text: "Say stock." }]);
    const bad = await call("check_draft", { text: "Use broth", network: "linkedin" });
    expect(bad.isError).not.toBe(true);
    expect(JSON.parse(answer(bad))).toMatchObject({ status: "refused", saved: false });
    expect(JSON.parse(answer(await call("check_draft", { text: "Use stock", network: "linkedin" })))).toMatchObject({ status: "passed", saved: false });
    rules.get("person-a")![0].level = "warn";
    expect(JSON.parse(answer(await call("check_draft", { text: "Use broth", network: "linkedin" })))).toMatchObject({ status: "flagged", saved: false });
    expect(aiCalls.settle).toHaveBeenCalledTimes(3);
    expect(posts).toHaveLength(0);
    expect(buffer.calls).toHaveLength(0);
    expect(JSON.parse(answer(await call("check_draft", { text: "Use stock", network: "linkedin" }, "person-b"))).status).toBe("not_checked");
  });
  it("returns a normal refusal for overlong text but keeps invalid tool inputs as errors", async () => {
    const overlong = await call("check_draft", { text: "x".repeat(281), network: "twitter" });
    expect(overlong.isError).not.toBe(true);
    expect(JSON.parse(answer(overlong))).toMatchObject({ status: "refused", saved: false });
    expect((await call("check_draft", { text: "", network: "twitter" })).isError).toBe(true);
    expect((await call("check_draft", { text: "A valid draft", network: "unsupported" })).isError).toBe(true);
    expect(aiCalls.settle).not.toHaveBeenCalled();
    expect(posts).toHaveLength(0);
    expect(buffer.calls).toHaveLength(0);
  });
  it("lists and removes only the token owner's sources", async () => {
    const a = await sources.add("person-a", "https://a.example/feed", "A");
    const b = await sources.add("person-b", "https://b.example/feed", "B");
    expect(answer(await call("list_sources"))).toContain(a.id);
    expect(answer(await call("list_sources"))).not.toContain(b.id);
    expect((await call("remove_source", { id: b.id, userId: "person-b" })).isError).toBe(true);
    await call("remove_source", { id: a.id });
    expect(await sources.list("person-a")).toHaveLength(0);
    expect(await sources.list("person-b")).toHaveLength(1);
  });
  it("reports the screen's true readiness and keeps human approval incomplete", async () => {
    expect(JSON.parse(answer(await call("get_setup_status")))).toMatchObject({ done: 2, total: 5 });
    await voices.addExample("person-a", { postId: "sample", channel: "Pasted", text: "Shipped this." });
    expect(JSON.parse(answer(await call("get_setup_status"))).done).toBe(3);
    await sources.add("person-a", "https://a.example/feed", "A");
    const status = JSON.parse(answer(await call("get_setup_status")));
    expect(status.done).toBe(4);
    expect(status.steps.find((s: { id: string }) => s.id === "approve").state).toBe("todo");
    expect(JSON.parse(answer(await call("get_setup_status", {}, "person-b"))).done).toBe(2);
  });
  it("keeps and dismisses signed suggestions with tenant isolation and stored evidence", async () => {
    const { signSuggestion } = await import("@/lib/rule-suggestions");
    const token = signSuggestion("person-a", { key: "first:test", rule: { kind: "guidance", text: "Use short sentences.", channels: "all", level: "warn" }, fixes: 2, evidence: [{ before: "Long", after: "Short" }] });
    expect((await call("keep_suggestion", { token }, "person-b")).isError).toBe(true);
    expect((await call("dismiss_suggestion", { token }, "person-b")).isError).toBe(true);
    const r = JSON.parse(answer(await call("keep_suggestion", { token })));
    expect(r.ok).toBe(true);
    expect(answer(await call("read_rule", { id: r.id }))).toContain('"before": "Long"');
    await call("keep_suggestion", { token });
    expect(rules.get("person-a")).toHaveLength(1);
    await call("dismiss_suggestion", { token });
    expect(dismissed.get("person-a")?.has("first:test")).toBe(true);
    expect((await call("keep_suggestion", { token })).isError).toBe(true);
  });
  it("runs the built-in writer through real playbook refusal, retry, Buffer draft saves and readback", async () => {
    const writer = await import("@/lib/ai-writer");
    const draftWriter = vi.spyOn(writer, "writeDrafts").mockImplementation(async (_model, brief) => brief.slots.map(s => ({ slotId: s.id, text: brief.retry ? "Use stock for this recipe." : "Use broth for this recipe.", sourceKey: brief.material[0].key })));
    try {
      rules.set("person-a", [{ id: "stock", kind: "replace", from: "broth", to: "stock", channels: "all", level: "block", text: "Say stock." }]);
      await material.add("person-a", { title: "Recipe", text: "Use stock for this recipe." });
      const r = await call("write_my_week", { userId: "person-b" });
      expect(r.isError).not.toBe(true);
      expect(JSON.parse(answer(r))).toMatchObject({ ok: true, retried: 2, refused: [] });
      expect(posts).toHaveLength(2);
      expect(posts.every(p => p.status === "draft" && p.text.includes("stock"))).toBe(true);
      expect(draftWriter).toHaveBeenCalledTimes(2);
      expect(aiCalls.settle).toHaveBeenCalledTimes(1);
      const drafts = JSON.parse(answer(await call("list_my_drafts"))).drafts;
      expect(drafts).toHaveLength(2);
      expect(drafts[0].verdicts[0].verdict).toBe("pass");
      expect(JSON.parse(answer(await call("list_my_drafts", {}, "person-b"))).drafts).toHaveLength(0);
      posts[0].text = "Manually changed";
      vi.setSystemTime(new Date("2026-10-29T12:02:00Z"));
      await call("refresh_buffer");
      expect(JSON.parse(answer(await call("list_my_drafts"))).drafts[0]).toMatchObject({ changedSinceCheck: true, verdicts: null });
      expect(buffer.calls.some(c => /schedulePost|publishPost/.test(c.query))).toBe(false);
    } finally { draftWriter.mockRestore(); }
  });
  it("lists owned drafts even when Buffer reports via=buffer, excluding other apps and scheduled posts", async () => {
    posts = ["ours", "foreign", "scheduled"].map(id => ({ id, channelId: "ch", status: id === "scheduled" ? "scheduled" : "draft", via: "buffer", text: "A useful release for builders.", dueAt: "2026-11-02T09:00:00.000Z", sentAt: null, externalLink: null, error: null } as Post));
    written.set("person-a", [{ postId: "ours", text: posts[0].text!, network: "twitter" }, { postId: "scheduled", text: posts[2].text!, network: "twitter" }]);
    written.set("person-b", [{ postId: "foreign", text: posts[1].text!, network: "twitter" }]);
    const result = JSON.parse(answer(await call("list_my_drafts")));
    expect(result.drafts.map((p: { postId: string }) => p.postId)).toEqual(["ours"]);
  });
  it("gives back the AI action when the built-in writer has no material", async () => {
    const r = await call("write_my_week");
    expect(r.isError).toBe(true);
    expect(answer(r)).toContain("No new material");
    expect(aiCalls.giveBack).toHaveBeenCalledTimes(1);
    expect(aiCalls.settle).toHaveBeenCalledTimes(1);
    expect(posts).toHaveLength(0);
  });
  it("hides storage failures from new controls", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const fail = vi.spyOn(ruleStore, "list").mockRejectedValue(new Error("private person-a SQL details"));
    try {
      const r = await call("read_rule", { id: "secret" });
      expect(r.isError).toBe(true);
      expect(answer(r)).not.toMatch(/person-a|SQL|secret/);
    } finally { fail.mockRestore(); log.mockRestore(); }
  });
});


describe("remaining account controls", () => {
  it("removes only owned research and preserves existing drafts", async () => {
    const a = await material.add("person-a", { title: "A", text: "My research" });
    const b = await material.add("person-b", { title: "B", text: "Private research" });
    expect((await call("remove_material", { key: b.key, userId: "person-b" })).isError).toBe(true);
    await call("remove_material", { key: a.key });
    expect(await material.get("person-a", a.key)).toBeNull();
    expect(await material.get("person-b", b.key)).not.toBeNull();
    expect(buffer.calls).toHaveLength(0);
  });
  it("lists genuine repeated fixes from only the authenticated user's written drafts", async () => {
    posts = [1, 2].map(i => ({ id: `p${i}`, channelId: "ch", status: "draft" as const, via: "api" as const, text: `Use stock to make soup number ${i} for dinner.`, dueAt: "2026-11-02T09:00:00.000Z", sentAt: null, externalLink: null, error: null }));
    written.set("person-a", posts.map(p => ({ postId: p.id, text: p.text.replace("stock", "broth"), network: "linkedin" })));
    await call("refresh_buffer");
    posts = posts.map(p => ({ ...p, text: p.text!.replace("stock", "broth") }));
    vi.setSystemTime(new Date("2026-10-29T12:02:00Z"));
    await call("refresh_buffer");
    posts = posts.map(p => ({ ...p, text: p.text!.replace("broth", "stock") }));
    vi.setSystemTime(new Date("2026-10-29T12:03:00Z"));
    const found = JSON.parse(answer(await call("list_rule_suggestions", { mode: "fixes" })));
    expect(found.suggestions).toHaveLength(1);
    expect(found.suggestions[0].rule).toMatchObject({ kind: "replace", from: "broth", to: "stock" });
    expect(found.suggestions[0].evidence.examples).toHaveLength(2);
    expect(JSON.parse(answer(await call("list_rule_suggestions", { mode: "fixes" }, "person-b"))).suggestions).toHaveLength(0);
    await call("dismiss_suggestion", { token: found.suggestions[0].token });
    expect(JSON.parse(answer(await call("list_rule_suggestions", { mode: "fixes" }))).suggestions).toHaveLength(0);
  });
  it("learns a repeated emoji removal through the connector and keeps its real evidence", async () => {
    posts = [1, 2].map(i => ({ id: `emoji-${i}`, channelId: "ch", status: "draft" as const, via: "buffer" as const, text: `A useful release for builders today, part ${i}.`, dueAt: "2026-11-02T09:00:00.000Z", sentAt: null, externalLink: null, error: null }));
    written.set("person-a", posts.map(p => ({ postId: p.id, text: `${p.text} 🚀`, network: "twitter" })));
    const found = JSON.parse(answer(await call("list_rule_suggestions", { mode: "fixes" })));
    expect(found.suggestions).toHaveLength(1);
    expect(found.suggestions[0].rule).toMatchObject({ kind: "banned", phrases: ["🚀"], level: "block" });
    expect(found.suggestions[0].evidence.examples).toHaveLength(2);
    const kept = JSON.parse(answer(await call("keep_suggestion", { token: found.suggestions[0].token })));
    expect(kept.ok).toBe(true);
    expect(answer(await call("read_rule", { id: kept.id }))).toContain("🚀");
  });
  it("reads channels and AI allowance without consuming an AI action", async () => {
    vi.stubEnv("SETTINGS_KEY", "");
    const channels = JSON.parse(answer(await call("list_channels")));
    expect(channels.channels[0]).toMatchObject({ id: "ch", isDisconnected: false, isQueuePaused: false });
    const usage = answer(await call("get_ai_usage"));
    expect(JSON.parse(usage)).toMatchObject({ ownKeySaved: false, builtIn: { budgetUsd: 100, leftUsd: 99.95 } });
    expect(usage).not.toContain("never-display");
    expect(aiCalls.settle).not.toHaveBeenCalled();
  });
});
