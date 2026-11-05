const exaState = vi.hoisted(() => ({ key: "exa-test" as string | null, search: vi.fn(async (..._a: unknown[]) => ({ status: "ready", results: [] }) as unknown), page: vi.fn(async (..._a: unknown[]) => ({ status: "failed", message: "Exa could not read that page." }) as unknown) }));
vi.mock("@/lib/exa", async (original) => ({ ...await original<typeof import("@/lib/exa")>(), searchWeb: (...a: unknown[]) => exaState.search(...a), readPage: (...a: unknown[]) => exaState.page(...a) }));
vi.mock("@/lib/env", async (original) => ({ ...await original<typeof import("@/lib/env")>(), exaKey: async () => exaState.key }));
const sourceCalls = vi.hoisted(() => ({ captured: [] as unknown[][], repair: vi.fn(async () => {}), list: vi.fn(async () => [] as { sourceKey: string; uri: string; evidence: { postId: string }[] }[]), report: vi.fn(async () => ({ changed: true, pending: 0 })), transcript: vi.fn(async () => ({ status: "pending", jobId: "job-1" })) }));
vi.mock("@/lib/source-check", () => ({ listSourcesToCheck: (...a: unknown[]) => sourceCalls.list(...a as []), reportSourceVersion: (...a: unknown[]) => sourceCalls.report(...a as []) }));
vi.mock("@/lib/transcript-for-user", () => ({ transcriptForUser: (...a: unknown[]) => sourceCalls.transcript(...a as []) }));
vi.mock("@/lib/source-store", () => ({ latestSource: async () => ({ id: "snapshot-test" }), captureSource: async (_u: string, data: { text: string }, metadata: unknown = {}) => { sourceCalls.captured.push([data, metadata]); return { id: "snapshot-test", ...data, metadata }; }, sourceById: async (user: string, id: string) => ["saved-podcast", "long-podcast"].includes(id) ? (user === "person-a" ? { id, sourceKey: "yt:abcdefghijk", uri: "https://youtube.com/watch?v=abcdefghijk", text: id === "long-podcast" ? "Whole transcript. ".repeat(5000) + "Closing evidence." : "Intro. Closing evidence.", metadata: { kind: "transcript", truncated: false, segments: [{ text: "Intro.", seconds: 0 }, { text: "Closing evidence.", seconds: 7190 }] } } : null) : ({ text: "CSV export is live. Includes archived rows.", metadata: {} }), recordEvidence: vi.fn(async () => {}), replaceDraftEvidence: (...a: unknown[]) => sourceCalls.repair(...a as []), sourceHoldsForPosts: async () => new Map() }));
vi.mock("@/lib/source-presentation", () => ({ sourceCards: vi.fn(async () => []) }));
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { Channel, Post } from "@/lib/buffer/queries"
import type { Written } from "@/lib/written-store"
import type { Rule } from "@/lib/rules"
import { fakeBuffer } from "@/test/fake-buffer"
import { BufferApiError } from "@/lib/buffer/client"
import { answering, deciding } from "@/lib/ai-test-model"
import { nextWeekRange } from "@/lib/week-from-buffer"

const ownKey = vi.hoisted(() => ({ saved: null as null | { provider: string, key: string, model: string }, setModel: vi.fn() }))
vi.mock("@/lib/ai-key-store", async (orig) => ({
  ...(await orig<object>()),
  postgresAiKeyStore: () => ({ get: async () => ownKey.saved, setModel: ownKey.setModel }),
}))
vi.mock("@/lib/ai-models", async (orig) => ({ ...(await orig<object>()), listModels: async () => ({ models: [{ id: "model-a" }, { id: "model-b" }] }) }))
// Saving the setting gives it a new revision, as the real table's updated_at does; claims are kept in memory.
const perm = vi.hoisted(() => {
  let mode: "ask" | "direct" | "off" = "ask", revision = 0
  return { get mode() { return mode }, set mode(m) { mode = m; revision++ }, get revision() { return String(revision) }, approve: vi.fn(), claims: new Set<string>() }
})
vi.mock("@/lib/agent-permission", async (orig) => ({
  ...(await orig<object>()),
  approveMode: async () => perm.mode,
  approvePermission: async () => ({ mode: perm.mode, revision: perm.revision }),
  claimApproval: async (_u: string, nonce: string) => (perm.claims.has(nonce) ? false : (perm.claims.add(nonce), true)),
  releaseApproval: async (_u: string, nonce: string) => { perm.claims.delete(nonce) },
}))
vi.mock("@/lib/approve-drafts", async (orig) => ({ ...(await orig<object>()), approveDrafts: (...a: unknown[]) => perm.approve(...a) }))
vi.mock("@/db", () => ({ db: () => { throw new Error("Unexpected database call") } }))
vi.mock("@/lib/auth", () => ({ getAuth: async () => ({ $context: Promise.resolve({ baseURL: "https://app.example/api/auth" }) }), mcpResource: (url: string) => `${url}/api/mcp` }))
vi.mock("@better-auth/mcp", () => ({
  requireMcpAuth: (_auth: unknown, handler: (req: Request, claims: { sub?: string, azp: string }) => Promise<Response>) => (req: Request) => {
    const sub = req.headers.get("authorization")?.replace("Bearer ", "")
    return sub ? handler(req, { sub, azp: "test-client" }) : new Response("Unauthorized", { status: 401 })
  },
}))
const approval = vi.hoisted(() => ({ state: { state: "approved" } as { state: "approved" } | { state: "unused"; consentId: string } | { state: "none" }, revoke: vi.fn(async (..._a: unknown[]) => true) }));
vi.mock("@/lib/ai-access", () => ({ approvalState: async () => approval.state, revokeApp: approval.revoke, UNUSED_DAYS: 30, recordAppUse: async () => {}, approvedApps: async () => [{ name: "ChatGPT", lastUsedAt: "2026-10-29T12:00:00Z" }] }))
const limits = vi.hoisted(() => ({ blocked: "" }));
vi.mock("@/lib/rate-limit", () => ({ limit: async (kind: string) => ({ ok: kind !== limits.blocked }), limitHeaders: () => ({}) }))
vi.mock("@/lib/buffer-token", () => ({ bufferAccessToken: async (_auth: unknown, userId: string) => userId }))
vi.mock("@/lib/buffer/snapshot-store", () => ({ postgresSnapshotStore: () => snapshots }))
// The real in-memory attempt store, with the same claim and completion rules as Postgres.
const attemptStore = vi.hoisted(() => ({ store: null as unknown as ReturnType<typeof import("@/lib/promotion-attempts").memoryPromotionAttempts> }))
vi.mock("@/lib/promotion-attempts", async (original) => {
  const real = await original<typeof import("@/lib/promotion-attempts")>()
  attemptStore.store = real.memoryPromotionAttempts()
  return { ...real, postgresPromotionAttempts: () => attemptStore.store }
})
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
const confirm = vi.hoisted(() => ({ verdict: "preference" as "preference" | "fact", calls: 0, empty: false, wait: null as Promise<void> | null }));
vi.mock("@/lib/confirm-fixes", async (original) => ({ ...await original<typeof import("@/lib/confirm-fixes")>(), askVerdicts: async (_model: unknown, offers: object[]) => { confirm.calls++; if (confirm.wait) await confirm.wait; if (confirm.empty) return []; return offers.map((_o, i) => ({ candidate: i + 1, verdict: confirm.verdict, why: "Both drafts make the same change." })); } }));
const savedVerdicts = vi.hoisted(() => new Map<string, unknown>());
vi.mock("@/lib/fix-verdicts", async (original) => ({ ...await original<typeof import("@/lib/fix-verdicts")>(), postgresVerdictStore: () => ({
  get: async (u: string, k: string) => { const v = savedVerdicts.get(`${u}|${k}`); return v === undefined ? null : typeof v === "string" ? { kind: "busy" } : { kind: "answer", verdicts: v }; },
  claim: async (u: string, k: string) => { if (savedVerdicts.has(`${u}|${k}`)) return null; const t = `t${Math.random()}`; savedVerdicts.set(`${u}|${k}`, t); return t; },
  put: async (u: string, k: string, t: string, v: unknown) => { if (savedVerdicts.get(`${u}|${k}`) === t) savedVerdicts.set(`${u}|${k}`, v); },
  release: async (u: string, k: string, t: string) => { if (savedVerdicts.get(`${u}|${k}`) === t) savedVerdicts.delete(`${u}|${k}`); },
}) }));
const reviews = vi.hoisted(() => ({ links: [] as { id: string; userId: string; drafts: { postId: string; network: string; channel: string; dueAt: string | null; text: string }[]; revokedAt: string | null; comments: { id: string; postId: string; name: string; text: string; quote: string | null; start: number | null; end: number | null; createdAt: string }[] }[] }));
vi.mock("@/lib/review-store", async (original) => ({ ...await original<typeof import("@/lib/review-store")>(), postgresReviewStore: () => ({
  create: async (userId: string, drafts: typeof reviews.links[number]["drafts"]) => { const l = { id: `link-${reviews.links.length + 1}`, userId, drafts, revokedAt: null, comments: [] }; reviews.links.push(l); return { ...l, createdAt: "2026-10-29T12:00:00Z" }; },
  list: async (userId: string) => reviews.links.filter((l) => l.userId === userId).map((l) => ({ ...l, createdAt: "2026-10-29T12:00:00Z" })),
  revoke: async (userId: string, id: string) => { const l = reviews.links.find((x) => x.id === id && x.userId === userId); if (l) l.revokedAt = "2026-10-29T12:00:00Z"; return !!l; },
}) }));
const feedbackAnswer = vi.hoisted(() => ({ value: {} as unknown }));
const aiCalls = vi.hoisted(() => ({ settle: vi.fn(async () => {}), giveBack: vi.fn(async () => {}) }));
vi.mock("@/lib/judge-model", () => ({ AiCapError: class extends Error {}, allowanceFor: async () => ({ used: 1, cap: 20, budgetUsd: 100, leftUsd: 99.95, totalRemaining: 100 }), aiFor: async () => ({ cfg: { provider: "openai", key: "never-display", model: "test" }, language: answering({ quote: "broth", reason: "Use stock." }), decider: judge.model, source: "Queue Pilot key", ...aiCalls }), judgeModelFor: async () => ({
  language: answering(feedbackAnswer.value),
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
// Buffer collaboration Notes in the fake: what exists, whether the token has the Notes permission, and a dropped create.
const notesFake = { notes: [] as { postId: string; node: Record<string, unknown> }[], allowed: true, dropCreate: false, annotations: [] as unknown[] }
// The Buffer ideas board in the fake: its columns, its ideas, and a dropped create.
// Buffer tags in the fake.
const tagsFake = { tags: [] as { id: string; name: string; color: string; isLocked: boolean }[] }
// Buffer content items in the fake, keyed by id; promote can succeed, refuse, or fail after creating the drafts.
const itemsFake = { items: new Map<string, any>(), extraChannels: [] as Channel[], promote: "ok" as "ok" | "refuse" | "failAfter" | "throwAfter", promotes: 0, dropCreate: false, createRefusal: "", readFails: false, deleteThrows: false, reads: 0, attachOnRead: 0 }
// Buffer's template library, snippets, teammates and channel configuration in the fake.
const libFake = { orgs: ["org"], templatePages: 1, snippetPage: 100, noLimit: false, maxLength: 3000, snippetsAllowed: true, snippetsEntitled: true, templateCount: 0, snippets: [] as { id: string; name: string; text: string }[], authorization: [{ feature: "posting", status: "ok", reason: null }] as { feature: string; status: string; reason: string | null }[] }
const ideasFake = { groups: [{ id: "g1", name: "Next week", isLocked: false }], ideas: [] as Record<string, unknown>[], dropCreate: false }
let serial = 0
const channel: Channel = { id: "ch", name: "My channel", service: "linkedin", organizationId: "org", timezone: "UTC", isDisconnected: false, isLocked: false, isQueuePaused: false, postingSchedule: [{ day: "mon", paused: false, times: ["09:00", "12:00"] }] }
const judge = deciding((ids, state) => Object.fromEntries(ids.map((id) => [id, { type: "choice", choice: state.includes("broth") ? "fail" : "pass" }])))
const buffer = fakeBuffer((call) => {
  const { query, variables } = call
  if (query.includes("{ account")) return { account: { email: "a@example.com", timezone: "UTC", organizations: libFake.orgs.map((id) => ({ id })) } }
  if (query.includes("channels(input")) return { channels: [channel, ...itemsFake.extraChannels] }
  if (query.includes("posts(input")) return { posts: { edges: structuredClone(posts).map((node) => ({ node })), pageInfo: { hasNextPage: false } } }
  // Buffer content items in the fake: checked before the createContentItem save path, whose name is a prefix.
  if (query.includes("contentItems(")) return { contentItems: { edges: [...itemsFake.items.values()].map((node) => ({ node: structuredClone(node) })), pageInfo: { hasNextPage: false, endCursor: null } } }
  if (query.includes("contentItem(input")) {
    if (itemsFake.readFails) return new TypeError("fetch failed")
    const it = itemsFake.items.get(variables.input.id)
    // Someone attaches an image in Buffer between two reads, leaving the text unchanged.
    if (it && ++itemsFake.reads === itemsFake.attachOnRead) it.body.assets = [{ type: "image" }]
    if (!it) return new BufferApiError("Content item not found", 200)
    return { contentItem: structuredClone(it) }
  }
  if (query.includes("createContentItemDraft(")) {
    if (itemsFake.createRefusal) return new BufferApiError(itemsFake.createRefusal, 200)
    const existing = [...itemsFake.items.values()].find((i) => i.correlationId === variables.input.correlationId)
    if (existing) return { createContentItemDraft: { __typename: "CreateContentItemDraftSuccess", contentItem: structuredClone(existing) } }
    const it = { id: `ci-${itemsFake.items.size + 1}`, correlationId: variables.input.correlationId, organizationId: variables.input.organizationId, title: variables.input.title ?? null, targetDate: variables.input.targetDate ?? null, createdAt: "2026-11-05T00:00:00Z", allowedActions: ["updateContentItem", "deleteContentItem"], tags: [], body: { __typename: "DraftContent", text: variables.input.draft.text, aiAssisted: variables.input.draft.aiAssisted, assets: [] } }
    itemsFake.items.set(it.id, it)
    if (itemsFake.dropCreate) { itemsFake.dropCreate = false; return new TypeError("fetch failed") }
    return { createContentItemDraft: { __typename: "CreateContentItemDraftSuccess", contentItem: structuredClone(it) } }
  }
  if (query.includes("updateContentItemDraft(")) {
    const it = itemsFake.items.get(variables.input.id)!
    it.body = { __typename: "DraftContent", text: variables.input.draft.text, aiAssisted: true, assets: [] }
    return { updateContentItemDraft: { __typename: "UpdateContentItemDraftSuccess", contentItem: structuredClone(it) } }
  }
  if (query.includes("promoteContentItemDraftToPosts(")) {
    itemsFake.promotes++
    const it = itemsFake.items.get(variables.input.id)!
    if (itemsFake.promote === "refuse") return { promoteContentItemDraftToPosts: { __typename: "PromoteContentItemDraftToPostsFailure", message: "Invalid", errors: [{ __typename: "PostInvalidInputError", message: "Bad", channelId: "ch" }] } }
    // Like Buffer: a queued draft gets the next free time (here Wednesday next week, 15:00 UTC); a custom time is kept.
    const queued = new Date(nextWeekRange(new Date(), "UTC").start.getTime() + (2 * 24 + 15) * 3600_000).toISOString()
    const made: Post[] = variables.input.posts.map((p: { channelId: string; text: string; saveToDraft: boolean; needsApproval: boolean; mode: string; dueAt?: string }) => {
      expect(p).toMatchObject({ saveToDraft: true, needsApproval: false })
      return { id: `post-${++serial}`, channelId: p.channelId, text: p.text, dueAt: p.dueAt ?? queued, status: "draft", via: "api", sentAt: null, externalLink: null, error: null } as Post
    })
    posts.push(...made)
    it.body = { __typename: "PostContent", posts: made.map((m) => ({ id: m.id, channelId: m.channelId, status: "draft", text: m.text, dueAt: m.dueAt })) }
    if (itemsFake.promote === "failAfter") return { promoteContentItemDraftToPosts: { __typename: "PromoteContentItemDraftToPostsFailure", message: "Post processing failed", errors: [] } }
    if (itemsFake.promote === "throwAfter") return new TypeError("fetch failed")
    return { promoteContentItemDraftToPosts: { __typename: "PromoteContentItemDraftToPostsSuccess", contentItem: structuredClone(it) } }
  }
  if (query.includes("updateContentItem(")) {
    const it = itemsFake.items.get(variables.input.id)!
    if ("title" in variables.input) it.title = variables.input.title
    return { updateContentItem: { __typename: "UpdateContentItemSuccess", contentItem: structuredClone(it) } }
  }
  if (query.includes("deleteContentItem(")) {
    // Like Buffer: deleting an item deletes the posts made from it.
    const gone = itemsFake.items.get(variables.input.id)?.body?.posts?.map((p: { id: string }) => p.id) ?? []
    posts = posts.filter((p) => !gone.includes(p.id))
    itemsFake.items.delete(variables.input.id)
    if (itemsFake.deleteThrows) { itemsFake.readFails = true; return new TypeError("fetch failed") }
    return { deleteContentItem: { __typename: "EmptySuccess", _empty: "" } }
  }
  if (query.includes("createContentItem")) {
    const added: Post[] = variables.input.posts.map((p: { text: string, dueAt: string, saveToDraft: boolean }) => {
      expect(p.saveToDraft).toBe(true)
      return { id: `post-${++serial}`, channelId: channel.id, text: p.text, dueAt: p.dueAt, status: "draft", via: "api", sentAt: null, externalLink: null, error: null }
    })
    posts.push(...added)
    return { createContentItem: { __typename: "CreateContentItemSuccess", content: { body: { posts: added } } } }
  }
  if (query.includes("p0: post(input")) return Object.fromEntries(Object.entries(variables as Record<string, { id: string }>).map(([k, v]) => [`p${k.slice(1)}`, structuredClone(posts.find(p => p.id === v.id)) ?? null]))
  if (query.includes("post(input")) return { post: structuredClone(posts.find(p => p.id === variables.input.id)) }
  if (query.includes("editPost")) {
    expect(variables.input.saveToDraft).toBe(true)
    posts = posts.map((p) => p.id === variables.input.id ? { ...p, ...(variables.input.text !== undefined ? { text: variables.input.text } : {}), ...(variables.input.tagIds ? { tagIds: variables.input.tagIds } : {}) } : p)
    return { editPost: { __typename: "PostActionSuccess" } }
  }
  if (query.includes("deletePost")) {
    posts = posts.filter((p) => p.id !== variables.input.id)
    return { deletePost: { __typename: "DeletePostSuccess" } }
  }
  if (query.includes("collaborationNotes(") || query.includes("createCollaborationNote")) {
    if (!notesFake.allowed) return new BufferApiError("Forbidden", 200, "INSUFFICIENT_SCOPE")
    if (query.includes("createCollaborationNote")) {
      if (notesFake.dropCreate) return new TypeError("fetch failed")
      notesFake.annotations.push(variables.input.annotations)
      const node = { id: `note-${notesFake.notes.length + 1}`, text: variables.input.text, authorId: "me", author: { id: "me", name: "Me" }, allowedActions: ["updateNote", "deleteNote"], createdAt: "2026-11-04T09:00:00Z", updatedAt: "2026-11-04T09:00:00Z" }
      notesFake.notes.push({ postId: variables.input.subject.postId, node })
      return { createCollaborationNote: { __typename: "CreateCollaborationNoteSuccess", edge: { node } } }
    }
    return { collaborationNotes: { edges: notesFake.notes.filter((n) => n.postId === variables.input.subject.postId).map((n) => ({ node: n.node })), pageInfo: { hasNextPage: false, endCursor: null } } }
  }
  if (query.includes("tagsV2(")) return { tagsV2: { edges: tagsFake.tags.map((node) => ({ node })), pageInfo: { hasNextPage: false, endCursor: null } } }
  if (query.includes("updateTag(")) {
    const t = tagsFake.tags.find((x) => x.id === variables.input.id)
    if (!t) return { updateTag: { __typename: "InvalidInputError", message: "No such tag" } }
    if (tagsFake.tags.some((x) => x.name === variables.input.tag.name && x.id !== t.id)) return { updateTag: { __typename: "DuplicateError", message: "Duplicate" } }
    Object.assign(t, variables.input.tag)
    return { updateTag: { __typename: "TagActionSuccess", tag: t } }
  }
  if (query.includes("deleteTag(")) { tagsFake.tags = tagsFake.tags.filter((x) => x.id !== variables.input.id); return { deleteTag: { __typename: "DeleteTagActionSuccess", id: variables.input.id } } }
  if (query.includes("createTag(")) {
    const { name, color } = variables.input.tag
    if (tagsFake.tags.some((t) => t.name === name)) return { createTag: { __typename: "DuplicateError", message: "Duplicate" } }
    const tag = { id: `tag-${tagsFake.tags.length + 1}`, name, color, isLocked: false }
    tagsFake.tags.push(tag)
    return { createTag: { __typename: "TagActionSuccess", tag } }
  }
  if (query.includes("ideaGroups(")) return { ideaGroups: ideasFake.groups }
  if (query.includes("ideas(input")) return { ideas: { edges: ideasFake.ideas.map((node) => ({ node })), pageInfo: { hasNextPage: false, endCursor: null } } }
  if (query.includes("createIdea(")) {
    if (ideasFake.dropCreate) return new TypeError("fetch failed")
    const { organizationId, content, group } = variables.input
    const node = { id: `idea-${ideasFake.ideas.length + 1}`, organizationId, groupId: group?.groupId ?? null, createdAt: 1_762_160_400, content: { title: content.title ?? null, text: content.text ?? null, services: content.services ?? [], date: null }, aiAssisted: content.aiAssisted }
    ideasFake.ideas.push(node)
    return { createIdea: { __typename: "Idea", id: node.id } }
  }
  if (query.includes("postTemplates(") && libFake.templateCount) {
    // Like Buffer's library: N templates paged by `first`, with long placeholder labels; one late template is about holidays.
    const from = variables.after ? Number(String(variables.after).slice(1)) : 0
    const to = Math.min(from + variables.first, libFake.templateCount)
    const nodes = Array.from({ length: to - from }, (_, k) => { const n = from + k; return { id: `tpl-${n}`, title: n === 150 ? "Holiday hours" : `Release note ${n}`, description: n === 150 ? "Tell people when you are closed" : "Share what shipped this week and why it matters to the people who use it", emoji: "🚀", body: "I read {{the piece: an article, a post, a podcast episode, with the author's name}}. {{why it matters: what it changes for the people you make things for}}", visibility: "public", organizationId: variables.input.organizationId, updatedAt: "2026-11-01T00:00:00Z" } })
    return { postTemplates: { edges: nodes.map((node) => ({ node })), pageInfo: { hasNextPage: to < libFake.templateCount, endCursor: `o${to}` } } }
  }
  if (query.includes("postTemplates(")) {
    const i = variables.after ? Number(String(variables.after).slice(1)) : 0
    const last = i + 1 >= libFake.templatePages
    return { postTemplates: { edges: [{ node: { id: `tpl-${i}`, title: `Release ${i}`, description: "A release note", emoji: "🚀", body: "Shipped {{feature}}. {{link}}", visibility: "public", organizationId: variables.input.organizationId, updatedAt: "2026-11-01T00:00:00Z" } }], pageInfo: { hasNextPage: !last, endCursor: last ? null : `c${i + 1}` } } }
  }
  if (query.includes("postTemplate(")) return { postTemplate: variables.input.id === "tpl-0" ? { id: "tpl-0", title: "Release 0", description: "A release note", emoji: "🚀", body: "Shipped {{feature}}. {{link}}", visibility: "public", organizationId: "org", updatedAt: "2026-11-01T00:00:00Z" } : null }
  if (query.includes("snippets(") || query.includes("Snippet(")) {
    if (!libFake.snippetsAllowed) return new BufferApiError("Forbidden", 200, "INSUFFICIENT_SCOPE")
    if (!libFake.snippetsEntitled) return new BufferApiError("Organization does not have required entitlements", 200)
    if (query.includes("createSnippet(")) { const sn = { id: `sn-${libFake.snippets.length + 1}`, name: variables.input.name, text: variables.input.text }; libFake.snippets.push(sn); return { createSnippet: { __typename: "CreateSnippetSuccess", snippet: sn } } }
    if (query.includes("updateSnippet(")) { const sn = libFake.snippets.find((x) => x.id === variables.input.id); if (!sn) return { updateSnippet: { __typename: "VoidMutationError", message: "Snippet not found" } }; Object.assign(sn, { name: variables.input.name, text: variables.input.text }); return { updateSnippet: { __typename: "UpdateSnippetSuccess", snippet: sn } } }
    if (query.includes("deleteSnippet(")) { libFake.snippets = libFake.snippets.filter((x) => x.id !== variables.input.id); return { deleteSnippet: { __typename: "DeleteSnippetSuccess", id: variables.input.id } } }
    // Pages of libFake.snippetPage items, so a snippet can sit on a later page.
    const start = variables.after ? Number(String(variables.after).slice(2)) : 0
    const size = libFake.snippetPage
    const end = Math.min(start + size, libFake.snippets.length)
    return { snippets: { edges: libFake.snippets.slice(start, end).map((node) => ({ node })), pageInfo: { hasNextPage: end < libFake.snippets.length, endCursor: end < libFake.snippets.length ? `sc${end}` : null } } }
  }
  if (query.includes("selectableTeamMembers(")) return { selectableTeamMembers: { edges: [{ node: { id: "acc-1", name: "Sara", email: "sara@example.com", avatar: "", isLocked: false, urn: "urn:buffer:account:acc-1" } }], pageInfo: { hasNextPage: false, endCursor: null } } }
  if (query.includes("configuration(")) return { configuration: { channels: [{ channelId: channel.id, service: "linkedin", channelType: "profile", authorizationStatus: libFake.authorization, content: [{ configurationContentTypes: ["post"], rules: libFake.noLimit ? [] : [{ __typename: "LengthRule", property: "text", maxLength: libFake.maxLength }] }] }] } }
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
  sourceCalls.repair.mockClear(); sourceCalls.list.mockReset().mockResolvedValue([]); sourceCalls.report.mockClear(); sourceCalls.transcript.mockReset().mockResolvedValue({ status: "pending", jobId: "job-1" });
  feedbackAnswer.value = {}
  savedVerdicts.clear()
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(new Date("2026-10-29T12:00:00Z"))
  voices = memoryVoiceStore()
  sources = memorySourceStore()
  material = memoryMaterialStore()
  snapshots = memorySnapshotStore()
  written.clear()
  reviews.links.length = 0
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
      name: "queue-pilot", title: "Queue Pilot", version: (await import("../../../../package.json")).default.version, websiteUrl: "https://app.example",
      icons: [{ src: "https://app.example/icon-512.png", mimeType: "image/png", sizes: ["512x512"] }],
    });
  });
  it("turns off a connection unused for 30 days, retires its approval, and says how to reconnect", async () => {
    approval.state = { state: "unused", consentId: "consent-7" };
    approval.revoke.mockClear();
    try {
      const res = await POST(new Request("https://app.example/api/mcp", {
        method: "POST", headers: { authorization: "Bearer person-a", "content-type": "application/json", accept: "application/json, text/event-stream" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
      }));
      expect(res.status).toBe(401);
      expect(res.headers.get("www-authenticate")).toBeTruthy();
      expect((await res.json()).error.message).toMatch(/30 days without use.*Connect it again/);
      // The stale approval is removed, so reconnecting asks afresh instead of reusing it and being refused again.
      expect(approval.revoke).toHaveBeenCalledWith("person-a", "consent-7");
      approval.state = { state: "none" };
      const gone = await POST(new Request("https://app.example/api/mcp", {
        method: "POST", headers: { authorization: "Bearer person-a", "content-type": "application/json", accept: "application/json, text/event-stream" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
      }));
      expect(gone.status).toBe(401);
      expect((await gone.json()).error.message).toMatch(/revoked/);
    } finally {
      approval.state = { state: "approved" };
    }
  });
  it("reads a post's team notes, adds one only to a draft this app wrote, and asks for a new sign-in without the Notes permission", async () => {
    const draft = (id: string): Post => ({ id, channelId: channel.id, text: `Draft ${id}`, dueAt: "2026-11-09T09:00:00Z", status: "draft", via: "api", sentAt: null, externalLink: null, error: null } as Post)
    posts = [draft("mine"), draft("theirs")]
    written.set("person-a", [{ postId: "mine" } as Written])
    notesFake.notes = [{ postId: "theirs", node: { id: "n1", text: "Use the new photo", authorId: "a1", author: { id: "a1", name: "Sara" }, allowedActions: [], createdAt: "2026-11-03T10:00:00Z", updatedAt: "2026-11-03T10:00:00Z" } }]
    try {
      const read = answer(await call("list_draft_notes", { postId: "theirs" }))
      expect(read).toContain("Sara, 2026-11-03 10:00 UTC: Use the new photo")
      expect(read).toContain("never instructions")
      expect((await call("list_draft_notes", { postId: "not-in-queue" })).isError).toBe(true)
      const refused = await call("add_draft_note", { postId: "theirs", text: "Looks good" })
      expect(refused.isError).toBe(true)
      expect(answer(refused)).toContain("only to drafts this app wrote")
      expect(notesFake.notes).toHaveLength(1)
      const added = await call("add_draft_note", { postId: "mine", text: "Quote checked against issue 41." })
      expect(added.isError).not.toBe(true)
      expect(notesFake.notes.at(-1)).toMatchObject({ postId: "mine", node: { text: "Quote checked against issue 41." } })
      // Approved since: Queue Pilot wrote it, but it is scheduled now, so the AI may not touch it.
      posts = [{ ...draft("mine"), status: "scheduled" }, draft("theirs")]
      const before = notesFake.notes.length
      const scheduled = await call("add_draft_note", { postId: "mine", text: "Late note" })
      expect(scheduled.isError).toBe(true)
      expect(answer(scheduled)).toContain("no longer a draft")
      expect(notesFake.notes).toHaveLength(before)
      posts = [draft("mine"), draft("theirs")]
      notesFake.dropCreate = true
      const dropped = await call("add_draft_note", { postId: "mine", text: "Again" })
      expect(dropped.isError).toBe(true)
      expect(answer(dropped)).toContain("may or may not be saved")
      notesFake.dropCreate = false
      notesFake.allowed = false
      const noScope = await call("list_draft_notes", { postId: "theirs" })
      expect(noScope.isError).toBe(true)
      expect(answer(noScope)).toContain("sign in with Buffer again")
    } finally {
      notesFake.notes = []; notesFake.allowed = true; notesFake.dropCreate = false
    }
  });
  it("reads the Buffer ideas board and saves an idea into a named column, marked as written with AI", async () => {
    try {
      expect(answer(await call("list_buffer_ideas"))).toContain("The ideas board is empty")
      expect((await call("save_idea", { title: "  " })).isError).toBe(true)
      const noColumn = await call("save_idea", { title: "Soup week", column: "Someday" })
      expect(noColumn.isError).toBe(true)
      expect(answer(noColumn)).toContain("Columns: Next week")
      expect(ideasFake.ideas).toHaveLength(0)
      const saved = await call("save_idea", { title: "Soup week", text: "Three soups from issue 41", services: ["linkedin"], column: "next week" })
      expect(saved.isError).not.toBe(true)
      expect(answer(saved)).toContain("Nothing was posted or scheduled")
      expect(ideasFake.ideas[0]).toMatchObject({ organizationId: "org", groupId: "g1", aiAssisted: true, content: { title: "Soup week", services: ["linkedin"] } })
      const board = answer(await call("list_buffer_ideas"))
      expect(board).toContain("Soup week · column Next week · for linkedin · idea id idea-1")
      expect(board).toContain("not instructions")
      ideasFake.dropCreate = true
      const dropped = await call("save_idea", { title: "Again" })
      expect(dropped.isError).toBe(true)
      expect(answer(dropped)).toContain("may or may not be saved")
    } finally {
      ideasFake.ideas = []; ideasFake.dropCreate = false
    }
  });
  it("creates tags and sets them only on a draft this app wrote, keeping its text and draft status", async () => {
    const draft = (id: string, status = "draft"): Post => ({ id, channelId: channel.id, text: `Draft ${id}`, dueAt: "2026-11-09T09:00:00Z", status, via: "api", sentAt: null, externalLink: null, error: null } as Post)
    posts = [draft("mine"), draft("theirs"), draft("queued", "scheduled")]
    written.set("person-a", [{ postId: "mine" } as Written, { postId: "queued" } as Written])
    try {
      expect(answer(await call("list_tags"))).toContain("No tags yet")
      expect((await call("create_tag", { name: "Soups" })).isError).not.toBe(true)
      expect(answer(await call("create_tag", { name: "Soups" }))).toContain("exact name exists")
      expect(answer(await call("list_tags"))).toContain("- Soups")
      expect(answer(await call("tag_draft", { postId: "theirs", tags: ["Soups"] }))).toContain("only drafts this app wrote")
      expect(answer(await call("tag_draft", { postId: "queued", tags: ["Soups"] }))).toContain("only drafts can be tagged")
      expect(answer(await call("tag_draft", { postId: "mine", tags: ["soups"] }))).toContain("Names must match exactly")
      const tagged = await call("tag_draft", { postId: "mine", tags: ["Soups"] })
      expect(tagged.isError).not.toBe(true)
      expect(posts.find((p) => p.id === "mine")).toMatchObject({ text: "Draft mine", status: "draft", tagIds: ["tag-1"] })
      expect(posts.find((p) => p.id === "queued")).toMatchObject({ status: "scheduled" })
    } finally {
      tagsFake.tags = []
    }
  });
  it("reads templates, snippets, teammates and channel settings only inside the person's own organizations and channels", async () => {
    const bufferCalls = () => buffer.calls.map((c) => c.query)
    try {
      const foreign = await call("list_post_templates", { organizationId: "someone-elses-org" })
      expect(foreign.isError).toBe(true)
      expect(answer(foreign)).toContain("Choose one organizationId: org")
      const foreignChannel = await call("list_team_members", { channelId: "not-mine" })
      expect(foreignChannel.isError).toBe(true)
      for (const name of ["save_snippet", "delete_snippet", "list_snippets", "get_channel_settings"]) {
        const r = await call(name, { organizationId: "someone-elses-org", name: "x", hashtags: "#x", snippetId: "sn-1" })
        expect(r.isError, name).toBe(true)
      }
      expect(bufferCalls().filter((q) => /postTemplates\(|selectableTeamMembers\(|snippets\(|Snippet\(|configuration\(/.test(q))).toEqual([])
      const one = answer(await call("get_post_template", { templateId: "tpl-0" }))
      expect(one).toContain("<template_body>")
      expect(one).toContain("Placeholders to fill: feature, link")
      expect((await call("get_post_template", { templateId: "nope" })).isError).toBe(true)
      expect(answer(await call("list_team_members", { channelId: channel.id }))).toContain("Sara · sara@example.com · account id acc-1")
    } finally {
      libFake.snippets = []
    }
  });
  it("makes the assistant choose when the person has more than one organization", async () => {
    libFake.orgs = ["org", "org-2"]
    try {
      const r = await call("list_snippets")
      expect(r.isError).toBe(true)
      expect(answer(r)).toContain("Choose one organizationId: org, org-2")
      expect((await call("list_snippets", { organizationId: "org-2" })).isError).not.toBe(true)
      expect(buffer.calls.find((c) => c.query.includes("snippets("))?.variables.input).toEqual({ organizationId: "org-2" })
    } finally {
      libFake.orgs = ["org"]
    }
  });
  it("says Buffer has not enabled hashtag sets, without advising a reconnect, when the organization lacks them", async () => {
    libFake.snippetsEntitled = false
    try {
      for (const r of [await call("list_snippets"), await call("save_snippet", { name: "Launch", hashtags: "#ship" })]) {
        expect(r.isError).toBe(true)
        expect(answer(r)).toContain("Buffer has not enabled saved hashtag sets for this account")
        expect(answer(r)).not.toContain("Sign in with Buffer again")
      }
    } finally {
      libFake.snippetsEntitled = true
    }
  });
  it("tells the assistant to reconnect when the connection has no snippets permission, and keeps a partial template list resumable", async () => {
    libFake.snippetsAllowed = false
    libFake.templatePages = 6
    try {
      const noScope = await call("list_snippets")
      expect(noScope.isError).toBe(true)
      expect(answer(noScope)).toContain("Sign in with Buffer again")
      expect(answer(await call("save_snippet", { name: "Launch", hashtags: "#ship" }))).toContain("Sign in with Buffer again")
      // One Buffer page per answer here (the fake serves one template per page): the cursor resumes after it.
      const first = answer(await call("list_post_templates"))
      expect(first).toContain("1 template (partial list)")
      expect(first).toContain('cursor "c1"')
    } finally {
      libFake.snippetsAllowed = true; libFake.templatePages = 1
    }
  });
  it("lists Buffer's 165 templates 40 per answer, under 20 KB each, with a cursor that skips and repeats nothing", async () => {
    libFake.templateCount = 165
    try {
      const seen: string[] = []
      let cursor: string | undefined
      for (let i = 0; i < 10; i++) {
        const out = answer(await call("list_post_templates", cursor ? { cursor } : {}))
        expect(new TextEncoder().encode(out).length, `answer ${i}`).toBeLessThan(20_000)
        seen.push(...[...out.matchAll(/template id (tpl-\d+)/g)].map((m) => m[1]))
        // Short placeholder names only; the full labels stay in get_post_template.
        if (i === 0) { expect(out).toContain("fills: the piece, why it matters"); expect(out).not.toContain("a podcast episode") }
        cursor = out.match(/cursor "([^"]+)"/)?.[1]
        if (!cursor) break
      }
      expect(seen).toHaveLength(165)
      expect(new Set(seen).size).toBe(165)
      expect(seen).toEqual(Array.from({ length: 165 }, (_, n) => `tpl-${n}`))
    } finally {
      libFake.templateCount = 0
    }
  });
  it("finds a template on a later page by search, and continues a search without skipping", async () => {
    libFake.templateCount = 165
    try {
      const found = answer(await call("list_post_templates", { search: "holiday" }))
      expect(found).toContain('1 template matching "holiday"')
      expect(found).toContain("template id tpl-150")
      expect(found).toContain("looked at 165 templates")
      // A search with many matches stops after the page that reaches 40, returns every match on the pages read, and
      // its cursor continues the same search from the next page.
      const many = answer(await call("list_post_templates", { search: "release" }))
      const firstIds = [...many.matchAll(/template id (tpl-\d+)/g)].map((m) => m[1])
      // Never more than 40 in one answer, and well under 20 KB.
      expect(firstIds).toHaveLength(40)
      expect(new TextEncoder().encode(many).length).toBeLessThan(20_000)
      const next = many.match(/cursor "([^"]+)"/)?.[1]
      expect(next).toBeDefined()
      const rest = answer(await call("list_post_templates", { search: "release", cursor: next }))
      const restIds = [...rest.matchAll(/template id (tpl-\d+)/g)].map((m) => m[1])
      expect(new Set([...firstIds, ...restIds]).size).toBe(firstIds.length + restIds.length)
      expect(Number(restIds[0].slice(4))).toBe(Number(firstIds.at(-1)!.slice(4)) + 1)
      // The 39-then-40 case: templates 120-159 hold 39 matches (150 is "Holiday hours"), so the next request asks
      // Buffer for exactly one more template, and the cursor resumes right after it.
      const partial = answer(await call("list_post_templates", { search: "release", cursor: "o120" }))
      const partialIds = [...partial.matchAll(/template id (tpl-\d+)/g)].map((m) => m[1])
      expect(partialIds).toHaveLength(40)
      expect(partialIds.at(-1)).toBe("tpl-160")
      expect(partial).toContain('cursor "o161"')
    } finally {
      libFake.templateCount = 0
    }
  });
  it("saves, replaces and deletes a snippet, and reads them back", async () => {
    try {
      expect(answer(await call("list_snippets"))).toContain("No snippets yet")
      expect(answer(await call("save_snippet", { name: "Launch", hashtags: "#ship #buildinpublic" }))).toContain('Snippet "Launch" saved: #ship #buildinpublic (snippet id sn-1)')
      expect(answer(await call("save_snippet", { name: "Launch", hashtags: "#ship", snippetId: "sn-1" }))).toContain("updated")
      expect(answer(await call("list_snippets"))).toContain("- Launch: #ship · snippet id sn-1")
      expect(answer(await call("save_snippet", { name: "X", hashtags: "#x", snippetId: "sn-404" }))).toContain("Not saved: Snippet not found")
      expect(answer(await call("delete_snippet", { snippetId: "sn-1" }))).toContain("deleted")
      expect(libFake.snippets).toEqual([])
    } finally {
      libFake.snippets = []
    }
  });
  it("says posting is ok only when Buffer reports it, and never calls another feature's failure a posting failure", async () => {
    try {
      expect(answer(await call("get_channel_settings"))).toContain("post text up to 3000 characters · posting: ok")
      libFake.noLimit = true
      expect(answer(await call("get_channel_settings"))).toContain("text limit not reported · posting: ok")
      libFake.noLimit = false
      libFake.authorization = []
      expect(answer(await call("get_channel_settings"))).toContain("posting: not reported by Buffer")
      libFake.authorization = [{ feature: "comment", status: "notEnoughRights", reason: "Role too low" }]
      const other = answer(await call("get_channel_settings"))
      expect(other).toContain("posting: not reported by Buffer")
      expect(other).toContain("other features unavailable: comment: notEnoughRights (Role too low)")
      libFake.authorization = [{ feature: "posting", status: "needsRefresh", reason: null }]
      expect(answer(await call("get_channel_settings"))).toContain("posting: needsRefresh")
    } finally {
      libFake.authorization = [{ feature: "posting", status: "ok", reason: null }]
    }
  });
  describe("content items: write once, choose accounts later", () => {
    const second: Channel = { ...channel, id: "ch2", name: "Second", service: "twitter" }
    const reset = () => { itemsFake.items.clear(); itemsFake.extraChannels = []; itemsFake.promote = "ok"; itemsFake.promotes = 0; itemsFake.dropCreate = false; itemsFake.createRefusal = ""; itemsFake.readFails = false; itemsFake.deleteThrows = false; itemsFake.reads = 0; itemsFake.attachOnRead = 0; attemptStore.store.rows.clear() }
    afterEach(reset)
    const saveDraft = async (text = "Soup night: three soups from issue 41.", requestId: string = crypto.randomUUID()) => call("save_channel_less_draft", { text, title: "Issue 41", requestId })

    it("saves one channel-less draft even when an unclear save is retried with the same requestId, and refuses a stale replace", async () => {
      expect(answer(await call("save_channel_less_draft", { text: "No id" }))).toContain("Pass requestId")
      expect(itemsFake.items.size).toBe(0)
      const id = crypto.randomUUID()
      itemsFake.dropCreate = true
      expect(answer(await saveDraft(undefined, id))).toContain(`Retry with requestId "${id}"`)
      expect(answer(await saveDraft(undefined, id))).toContain("content item id ci-1")
      expect(itemsFake.items.size).toBe(1)
      const stale = await call("save_channel_less_draft", { contentItemId: "ci-1", text: "New", expectedText: "Something older" })
      expect(stale.isError).toBe(true)
      expect(answer(stale)).toContain("changed in Buffer since it was read")
      expect(itemsFake.items.get("ci-1").body.text).toBe("Soup night: three soups from issue 41.")
      expect((await call("save_channel_less_draft", { contentItemId: "ci-1", text: "New" })).isError).toBe(true)
      expect(answer(await call("save_channel_less_draft", { contentItemId: "ci-1", text: "Soup night!", expectedText: "Soup night: three soups from issue 41." }))).toContain("Draft text replaced")
    })

    it("reports Buffer's refusal of a save as a refusal, not as an unclear answer", async () => {
      itemsFake.createRefusal = "Invalid correlationId"
      const r = await saveDraft()
      expect(r.isError).toBe(true)
      expect(answer(r)).toContain("Not saved: Buffer refused it (Invalid correlationId)")
      expect(answer(r)).not.toContain("may or may not")
      expect(itemsFake.items.size).toBe(0)
    })

    it("keeps unknown Buffer errors and timeouts as unclear, so the same requestId is retried", async () => {
      const { refusedByBuffer } = await import("@/lib/content-item-flow")
      expect(refusedByBuffer(new BufferApiError("Internal server error", 200, "INTERNAL_SERVER_ERROR"))).toBe(false)
      expect(refusedByBuffer(new BufferApiError("Something went wrong", 200))).toBe(false)
      expect(refusedByBuffer(new BufferApiError("Invalid response from upstream", 200))).toBe(false)
      expect(refusedByBuffer(new BufferApiError("Invalid correlationId", 200))).toBe(true)
      expect(refusedByBuffer(new BufferApiError("text is required", 200))).toBe(true)
      expect(refusedByBuffer(new BufferApiError("Buffer API returned 408", 408))).toBe(false)
      expect(refusedByBuffer(new BufferApiError("Buffer API returned 503", 503))).toBe(false)
      expect(refusedByBuffer(new BufferApiError("Bad input", 200, "BAD_USER_INPUT"))).toBe(true)
      expect(refusedByBuffer(new BufferApiError("Buffer API returned 422", 422))).toBe(true)
      itemsFake.createRefusal = "Internal server error"
      const id = crypto.randomUUID()
      const r = answer(await saveDraft(undefined, id))
      expect(r).toContain(`Retry with requestId "${id}"`)
      expect(r).not.toContain("pass a new random UUID")
    })

    it("turns a draft into one checked draft per account with each version's own evidence, and never schedules", async () => {
      itemsFake.extraChannels = [second]
      rules.set("person-a", [{ id: "stock", kind: "replace", from: "broth", to: "stock", channels: "all", level: "block", text: "Say stock." }])
      await saveDraft()
      const { recordEvidence } = await import("@/lib/source-store")
      vi.mocked(recordEvidence).mockClear()
      const versions = [
        { channelId: "ch", text: "Intro. Closing evidence. Long form for LinkedIn.", snapshotId: "saved-podcast", evidence: [{ claim: "Intro.", quote: "Intro." }] },
        { channelId: "ch2", text: "Closing evidence. Short for X.", snapshotId: "saved-podcast", evidence: [{ claim: "Closing evidence.", quote: "Closing evidence." }] },
      ]
      const brothy = await call("promote_to_draft_posts", { contentItemId: "ci-1", expectedDraftText: "Soup night: three soups from issue 41.", versions: [versions[0], { ...versions[1], text: "Closing evidence. Made with broth, for X." }] })
      expect(JSON.parse(answer(brothy))).toMatchObject({ status: "refused", created: false })
      expect(itemsFake.promotes).toBe(0)
      const stale = await call("promote_to_draft_posts", { contentItemId: "ci-1", expectedDraftText: "An older draft", versions })
      expect(answer(stale)).toContain("changed in Buffer since it was reviewed")
      expect(itemsFake.promotes).toBe(0)
      const ok = answer(await call("promote_to_draft_posts", { contentItemId: "ci-1", expectedDraftText: "Soup night: three soups from issue 41.", versions }))
      expect(ok).toContain("Buffer has 2 drafts from this promotion; Queue Pilot recorded 2 as its own. None are scheduled.")
      // The next read tells the truth without a manual refresh: both new drafts are listed.
      const listed = answer(await call("list_my_drafts"))
      for (const v of versions) expect(listed).toContain(v.text)
      expect(posts.filter((p) => p.status !== "draft")).toEqual([])
      const mine = written.get("person-a") ?? []
      expect(mine.map((w) => w.text).sort()).toEqual(versions.map((v) => v.text).sort())
      expect(mine.every((w) => Array.isArray(w.verdicts) && w.playbookRevision)).toBe(true)
      expect(vi.mocked(recordEvidence).mock.calls.map((c) => [c[2], c[4]])).toEqual(versions.map((v) => [v.text, v.evidence]))
      // Deleting the item deletes its posts, and the next read no longer lists them.
      expect(answer(await call("delete_content_item", { contentItemId: "ci-1" }))).toContain("deleted")
      const after = answer(await call("list_my_drafts"))
      for (const v of versions) expect(after).not.toContain(v.text)
    })

    it("records the drafts after an unclear promote, whether Buffer returns a failure or the answer is lost, and a retry never promotes twice", async () => {
      for (const mode of ["failAfter", "throwAfter"] as const) {
        reset(); written.clear(); posts = []
        await saveDraft()
        itemsFake.promote = mode
        const v = [{ channelId: "ch", text: "Soup night on LinkedIn." }]
        const first = answer(await call("promote_to_draft_posts", { contentItemId: "ci-1", expectedDraftText: "Soup night: three soups from issue 41.", versions: v }))
        expect(first, mode).toContain("The drafts were created anyway. Buffer has 1 draft from this promotion; Queue Pilot recorded 1 as its own.")
        // Also after a recovery: the drafts Buffer did create show up on the next read.
        expect(answer(await call("list_my_drafts")), mode).toContain("Soup night on LinkedIn.")
        const recorded = structuredClone(written.get("person-a"))
        expect(recorded?.map((w) => w.text)).toEqual(["Soup night on LinkedIn."])
        expect(attemptStore.store.rows.get("person-a|ci-1")?.recordedAt).toBeInstanceOf(Date)
        // The recovery finished, so a retry is a no-op: no second promote, the saved record untouched.
        expect(answer(await call("promote_to_draft_posts", { contentItemId: "ci-1", expectedDraftText: "Soup night: three soups from issue 41.", versions: v }))).toContain("Already turned into drafts and recorded")
        expect(itemsFake.promotes).toBe(1)
        expect(written.get("person-a")).toEqual(recorded)
      }
      reset(); posts = []
      await saveDraft()
      itemsFake.promote = "refuse"
      const refused = await call("promote_to_draft_posts", { contentItemId: "ci-1", expectedDraftText: "Soup night: three soups from issue 41.", versions: [{ channelId: "ch", text: "Soup night." }] })
      expect(refused.isError).toBe(true)
      expect(answer(refused)).toContain("still a channel-less draft; nothing was created")
    })

    it("never adopts posts it did not create, and leaves drafts with media alone", async () => {
      await saveDraft()
      // Posts made in Buffer (or by another app) with the same account and text: no attempt by Queue Pilot exists.
      itemsFake.items.get("ci-1").body = { __typename: "PostContent", posts: [{ id: "elsewhere", channelId: "ch", status: "draft", text: "Soup night on LinkedIn.", dueAt: null }] }
      const adopt = await call("promote_to_draft_posts", { contentItemId: "ci-1", expectedDraftText: "Soup night: three soups from issue 41.", versions: [{ channelId: "ch", text: "Soup night on LinkedIn." }] })
      expect(adopt.isError).toBe(true)
      expect(answer(adopt)).toContain("did not create")
      expect(written.get("person-a") ?? []).toEqual([])
      // An attempt for different versions does not count either.
      attemptStore.store.rows.set("person-a|ci-1", { fingerprint: "something-else", token: "t", recordedAt: null, startedAt: new Date() })
      expect((await call("promote_to_draft_posts", { contentItemId: "ci-1", expectedDraftText: "x", versions: [{ channelId: "ch", text: "Soup night on LinkedIn." }] })).isError).toBe(true)
      expect(written.get("person-a") ?? []).toEqual([])
      await saveDraft("With a photo")
      itemsFake.items.get("ci-2").body.assets = [{ type: "image" }]
      expect(answer(await call("save_channel_less_draft", { contentItemId: "ci-2", text: "New", expectedText: "With a photo" }))).toContain("images or video attached")
      expect(answer(await call("promote_to_draft_posts", { contentItemId: "ci-2", expectedDraftText: "With a photo", versions: [{ channelId: "ch", text: "With a photo" }] }))).toContain("images or video attached")
      expect(itemsFake.items.get("ci-2").body).toMatchObject({ text: "With a photo", assets: [{ type: "image" }] })
      expect(itemsFake.promotes).toBe(0)
    })

    it("keeps recovery open until every draft is recorded with its evidence, then records nothing again", async () => {
      await saveDraft()
      const { recordEvidence } = await import("@/lib/source-store")
      vi.mocked(recordEvidence).mockClear().mockRejectedValueOnce(new Error("db down"))
      const v = [{ channelId: "ch", text: "Intro. Closing evidence.", snapshotId: "saved-podcast", evidence: [{ claim: "Intro.", quote: "Intro." }] }]
      const first = await call("promote_to_draft_posts", { contentItemId: "ci-1", expectedDraftText: "Soup night: three soups from issue 41.", versions: v })
      expect(first.isError).toBe(true)
      expect(answer(first)).toContain("Buffer has 1 draft from this promotion; Queue Pilot recorded 0 as its own")
      expect(written.get("person-a") ?? []).toEqual([])
      expect(attemptStore.store.rows.get("person-a|ci-1")?.recordedAt).toBeNull()
      const repair = answer(await call("promote_to_draft_posts", { contentItemId: "ci-1", expectedDraftText: "Soup night: three soups from issue 41.", versions: v }))
      expect(repair).toContain("Queue Pilot recorded 1 as its own")
      expect(written.get("person-a")).toHaveLength(1)
      expect(attemptStore.store.rows.get("person-a|ci-1")?.recordedAt).toBeInstanceOf(Date)
      const evidenceCalls = vi.mocked(recordEvidence).mock.calls.length
      expect(answer(await call("promote_to_draft_posts", { contentItemId: "ci-1", expectedDraftText: "Soup night: three soups from issue 41.", versions: v }))).toContain("Already turned into drafts and recorded")
      expect(vi.mocked(recordEvidence).mock.calls.length).toBe(evidenceCalls)
      expect(itemsFake.promotes).toBe(1)
    })

    it("stops a promotion when an image was attached in Buffer while the versions were being checked", async () => {
      await saveDraft()
      itemsFake.reads = 0
      itemsFake.attachOnRead = 2
      const r = await call("promote_to_draft_posts", { contentItemId: "ci-1", expectedDraftText: "Soup night: three soups from issue 41.", versions: [{ channelId: "ch", text: "Soup night." }] })
      expect(answer(r)).toContain("images or video attached")
      expect(itemsFake.promotes).toBe(0)
      expect(itemsFake.items.get("ci-1").body.assets).toEqual([{ type: "image" }])
    })

    it("checks each version against the account's own text limit from Buffer, not a fixed table", async () => {
      await saveDraft()
      libFake.maxLength = 20
      try {
        const r = JSON.parse(answer(await call("promote_to_draft_posts", { contentItemId: "ci-1", expectedDraftText: "Soup night: three soups from issue 41.", versions: [{ channelId: "ch", text: "This version is longer than twenty." }] })))
        expect(r).toMatchObject({ status: "refused", created: false })
        expect(r.refused[0]).toContain("this account's 20 character limit")
        expect(itemsFake.promotes).toBe(0)
        const checked = JSON.parse(answer(await call("check_draft", { text: "This version is longer than twenty.", network: "linkedin", channelId: "ch" })))
        expect(checked).toMatchObject({ status: "refused", limit: { max: 20, from: "buffer" } })
        // Buffer allows more than the built-in table: before the ordinary save, the stricter built-in limit still applies.
        libFake.maxLength = 25_000
        const long = "x".repeat(3100)
        const strict = JSON.parse(answer(await call("check_draft", { text: long, network: "linkedin", channelId: "ch" })))
        expect(strict).toMatchObject({ status: "refused", limit: { max: 3000, from: "built-in" } })
        expect(strict.reason).toContain("Queue Pilot's current save limit of 3000")
        expect(strict.reason).toContain("Buffer allows this account 25000")
      } finally {
        libFake.maxLength = 3000
      }
    })

    it("refuses a second promotion with different versions while the first is pending", async () => {
      await saveDraft()
      attemptStore.store.rows.set("person-a|ci-1", { fingerprint: "another-call", token: "t", recordedAt: null, startedAt: new Date() })
      const r = await call("promote_to_draft_posts", { contentItemId: "ci-1", expectedDraftText: "Soup night: three soups from issue 41.", versions: [{ channelId: "ch", text: "Soup night." }] })
      expect(r.isError).toBe(true)
      expect(answer(r)).toContain("still in progress")
      expect(itemsFake.promotes).toBe(0)
    })

    it("never takes a failed read for a missing or deleted item", async () => {
      await saveDraft()
      itemsFake.readFails = true
      const read = await call("get_content_item", { contentItemId: "ci-1" })
      expect(read.isError).toBe(true)
      expect(answer(read)).not.toContain("No content item with that id")
      itemsFake.readFails = false
      itemsFake.deleteThrows = true
      const del = await call("delete_content_item", { contentItemId: "ci-1" })
      expect(del.isError).toBe(true)
      expect(answer(del)).toContain("whether it was deleted is unknown")
      expect(answer(del)).not.toContain("delete took effect")
    })

    it("refuses another person's items, accounts and sources before writing, and renames, re-dates or deletes only on request", async () => {
      await saveDraft()
      const theirs = { ...itemsFake.items.get("ci-1"), id: "ci-x", organizationId: "someone-elses-org" }
      itemsFake.items.set("ci-x", theirs)
      expect(answer(await call("get_content_item", { contentItemId: "ci-x" }))).toContain("No content item with that id")
      expect((await call("delete_content_item", { contentItemId: "ci-x" })).isError).toBe(true)
      expect(itemsFake.items.has("ci-x")).toBe(true)
      expect(answer(await call("promote_to_draft_posts", { contentItemId: "ci-1", expectedDraftText: "Soup night: three soups from issue 41.", versions: [{ channelId: "not-mine", text: "x" }] }))).toContain("Not the person's accounts")
      expect(answer(await call("promote_to_draft_posts", { contentItemId: "ci-1", expectedDraftText: "Soup night: three soups from issue 41.", versions: [{ channelId: "ch", text: "x", snapshotId: "saved-podcast" }] }, "person-b"))).toContain("not in this account")
      expect(itemsFake.promotes).toBe(0)
      expect(answer(await call("update_content_item", { contentItemId: "ci-1", title: "Soup week" }))).toContain('"Soup week"')
      expect((await call("update_content_item", { contentItemId: "ci-1" })).isError).toBe(true)
      expect(answer(await call("list_content_items"))).toContain("Channel-less draft (written with AI)")
      expect(answer(await call("delete_content_item", { contentItemId: "ci-1" }))).toContain("deleted")
      expect(itemsFake.items.has("ci-1")).toBe(false)
    })
  })
  it("renames, recolors and deletes tags by exact name, refusing locked tags and duplicates", async () => {
    tagsFake.tags = [{ id: "t1", name: "Soups", color: "#8F2457", isLocked: false }, { id: "t2", name: "Stews", color: "#111111", isLocked: false }, { id: "t3", name: "Old", color: "#222222", isLocked: true }]
    try {
      expect((await call("rename_tag", { tag: "Soups" })).isError).toBe(true)
      expect(answer(await call("rename_tag", { tag: "soups", name: "Soup" }))).toContain("no tag with that exact name")
      expect(answer(await call("rename_tag", { tag: "Old", name: "New" }))).toContain("locked")
      expect(answer(await call("rename_tag", { tag: "Soups", name: "Stews" }))).toContain("exact name exists")
      expect(answer(await call("rename_tag", { tag: "Soups", name: "Soup week" }))).toContain('Tag "Soups" is now "Soup week" (#8F2457)')
      expect(answer(await call("rename_tag", { tag: "Stews", color: "#00AA00" }))).toContain('"Stews" (#00AA00)')
      expect(answer(await call("delete_tag", { tag: "Old" }))).toContain('Tag "Old" deleted')
      expect(tagsFake.tags.map((t) => t.name)).toEqual(["Soup week", "Stews"])
      expect((await call("delete_tag", { tag: "Old" })).isError).toBe(true)
    } finally {
      tagsFake.tags = []
    }
  });
  it("mentions only teammates who can read notes on the post's channel, and only where the note names them", async () => {
    const draft: Post = { id: "mine", channelId: channel.id, text: "Draft", dueAt: "2026-11-09T09:00:00Z", status: "draft", via: "api", sentAt: null, externalLink: null, error: null } as Post
    posts = [draft]
    written.set("person-a", [{ postId: "mine" } as Written])
    try {
      expect(answer(await call("add_draft_note", { postId: "mine", text: "Please check this", mention: ["acc-1"] }))).toContain("write each mention into the note first: @Sara")
      expect(answer(await call("add_draft_note", { postId: "mine", text: "@Sara please check", mention: ["acc-9"] }))).toContain("cannot be mentioned on this channel: acc-9")
      expect(notesFake.notes).toHaveLength(0)
      expect((await call("add_draft_note", { postId: "mine", text: "Thanks @Sara, checked.", mention: ["acc-1"] })).isError).not.toBe(true)
      expect(notesFake.annotations.at(-1)).toEqual([{ type: "mention", content: "@Sara", text: "@Sara", displayValue: "Sara", serviceEntityId: "urn:buffer:account:acc-1", indices: [7, 12] }])
      expect(buffer.calls.find((c) => c.query.includes("selectableTeamMembers("))?.variables.input.scope).toEqual({ channelId: channel.id })
    } finally {
      notesFake.notes = []; notesFake.annotations = []
    }
  });
  it("reports each channel's daily posting limit and Buffer's request allowance", async () => {
    const r = answer(await call("get_buffer_limits"))
    expect(r).toContain("Daily posting limits right now:")
    expect(r).toContain("- My channel (linkedin): no daily limit (0 counted now).")
    expect(r).toMatch(/Buffer requests left|did not report its request allowance/)
  });
  it("says in the week view when a channel's queue is paused in Buffer", async () => {
    expect(answer(await call("show_next_week"))).not.toContain("paused")
    channel.isQueuePaused = true
    snapshots = memorySnapshotStore() // a fresh read of Buffer, not the copy saved a moment ago
    try {
      expect(answer(await call("show_next_week"))).toContain("My channel's queue is paused in Buffer, so its scheduled posts will not go out")
    } finally {
      channel.isQueuePaused = false
    }
  });
  it("lists all tools with serializable input schemas", async () => {
    const response = await rpc("tools/list", {})
    expect(response.error).toBeUndefined()
    const tools = response.result.tools
    expect(tools).toHaveLength(73)
    expect(tools.map((t: { name: string }) => t.name)).toEqual(expect.arrayContaining(["share_for_review", "list_review_comments", "turn_off_review", "propose_rule_fixes"]))
    expect(tools.map((t: { name: string }) => t.name)).not.toEqual(expect.arrayContaining(["approve", "schedule", "delete_account", "save_ai_key"]))
    expect(tools.find((t: { name: string }) => t.name === "add_voice_example").inputSchema.properties.text.maxLength).toBe(MAX_PASTED_TEXT)
    expect(tools.find((t: { name: string }) => t.name === "save_my_voice_note").inputSchema.properties.note.maxLength).toBe(MAX_NOTE)
  })

  it("declares honest MCP hints on every one of the 73 tools as clients receive them", async () => {
    const tools = (await rpc("tools/list", {})).result.tools as { name: string; title?: string; description?: string; annotations?: Record<string, unknown> }[]
    // Control: the answer includes tools from all three registration modules.
    expect(tools.map((t) => t.name)).toEqual(expect.arrayContaining(["show_next_week", "check_draft", "promote_to_draft_posts"]))
    for (const t of tools) {
      expect(typeof t.title === "string" && t.title.length > 0, `${t.name} title`).toBe(true)
      expect(typeof t.description === "string" && t.description.length > 0, `${t.name} description`).toBe(true)
      for (const h of ["readOnlyHint", "destructiveHint", "openWorldHint"]) expect(typeof t.annotations?.[h], `${t.name} ${h}`).toBe("boolean")
    }
    // Every Buffer write, including the content-item writes, is marked as reaching outside and not read-only.
    const bufferWrites = ["save_drafts", "write_my_week", "update_draft", "delete_draft", "approve_drafts", "add_draft_note", "save_idea", "create_tag", "tag_draft", "save_snippet", "delete_snippet", "rename_tag", "delete_tag",
      "save_channel_less_draft", "promote_to_draft_posts", "update_content_item", "delete_content_item", "link_post_to_content_item", "unlink_post_from_content_item"]
    for (const name of bufferWrites) {
      const t = tools.find((x) => x.name === name)
      expect(t?.annotations, name).toMatchObject({ readOnlyHint: false, openWorldHint: true })
    }
    for (const name of ["delete_draft", "delete_snippet", "delete_tag", "delete_content_item"]) expect(tools.find((x) => x.name === name)?.annotations, name).toMatchObject({ destructiveHint: true })
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
  it("fills a template from the source, spends nothing while a placeholder is empty, and checks the result with the playbook", async () => {
    rules.set("person-a", [{ id: "stock", kind: "replace", from: "broth", to: "stock", channels: "all", level: "block", text: "Say stock." }]);
    libFake.snippets = [{ id: "sn-1", name: "Soup", text: "#soup" }]
    try {
      const half = JSON.parse(answer(await call("fill_post_template", { templateId: "tpl-0", values: { feature: "broth packs" }, network: "linkedin" })))
      expect(half).toMatchObject({ status: "needs_values", missing: ["link"], saved: false })
      expect(aiCalls.settle).not.toHaveBeenCalled()
      const refused = JSON.parse(answer(await call("fill_post_template", { templateId: "tpl-0", values: { feature: "broth packs", link: "https://x.example/41" }, network: "linkedin" })))
      expect(refused).toMatchObject({ status: "refused", saved: false, text: "Shipped broth packs. https://x.example/41", template: "Release 0" })
      const passed = JSON.parse(answer(await call("fill_post_template", { templateId: "tpl-0", values: { feature: "stock packs", link: "https://x.example/41" }, network: "linkedin", snippetId: "sn-1" })))
      expect(passed).toMatchObject({ status: "passed", text: "Shipped stock packs. https://x.example/41\n\n#soup" })
      expect((await call("fill_post_template", { templateId: "nope", values: {}, network: "linkedin" })).isError).toBe(true)
      // A snippet the person found on a later page is still found, never called missing.
      // 450 sets at 100 a page: one read takes 300, so set 420 sits beyond the first batch.
      libFake.snippets = Array.from({ length: 450 }, (_, i) => ({ id: `sn-${i + 1}`, name: `Set ${i + 1}`, text: `#tag${i + 1}` }))
      const later = JSON.parse(answer(await call("fill_post_template", { templateId: "tpl-0", values: { feature: "stock packs", link: "https://x.example/41" }, network: "linkedin", snippetId: "sn-420" })))
      expect(later).toMatchObject({ status: "passed", text: "Shipped stock packs. https://x.example/41\n\n#tag420" })
      expect(posts).toHaveLength(0)
      expect(buffer.calls.some((c) => /createContentItem|createPost|editPost/.test(c.query))).toBe(false)
    } finally {
      libFake.snippets = []; libFake.snippetPage = 100
    }
  });
  it("counts length the way Buffer counts it for the network, not raw characters", async () => {
    // An X post with a long link: the link counts as 23, so 250 letters plus the link fit in 280.
    const xPost = `${"a".repeat(250)} https://example.com/${"p".repeat(300)}`
    expect(JSON.parse(answer(await call("check_draft", { text: xPost, network: "twitter" }))).status).not.toBe("refused")
    // Instagram counts each line break twice: 2180 letters with 10 line breaks inside count 2200, over 2196.
    const ig = `${"a".repeat(1090)}${"\n".repeat(10)}${"a".repeat(1090)}`
    expect(JSON.parse(answer(await call("check_draft", { text: ig, network: "instagram" })))).toMatchObject({ status: "refused" })
    // check_draft trims its input, so line breaks at the very end are not counted and the same letters fit.
    const trailing = `${"a".repeat(2180)}${"\n".repeat(10)}`
    expect(JSON.parse(answer(await call("check_draft", { text: trailing, network: "instagram" }))).status).not.toBe("refused")
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
    expect(found.suggestions[0].evidence.why).toBe("Both drafts make the same change.");
    expect(found.suggestions[0].evidence.examples).toHaveLength(2);
    const kept = JSON.parse(answer(await call("keep_suggestion", { token: found.suggestions[0].token })));
    expect(kept.ok).toBe(true);
    expect(answer(await call("read_rule", { id: kept.id }))).toContain("🚀");
  });
  it("offers no rule when the model reads a repeated fix as a one-off fact, and settles the AI action", async () => {
    confirm.verdict = "fact";
    posts = [1, 2].map(i => ({ id: `fact-${i}`, channelId: "ch", status: "draft" as const, via: "buffer" as const, text: `Release ${i} is out today for builders.`, dueAt: "2026-11-02T09:00:00.000Z", sentAt: null, externalLink: null, error: null }));
    written.set("person-a", posts.map(p => ({ postId: p.id, text: `${p.text} https://example.com/old`, network: "twitter" })));
    const found = JSON.parse(answer(await call("list_rule_suggestions", { mode: "fixes" })));
    confirm.verdict = "preference";
    expect(found.suggestions).toHaveLength(0);
    expect(found.note).toContain("none looked like a lasting preference");
    expect(aiCalls.settle).toHaveBeenCalled();
  });
  it("applies the AI limit only when the model must be asked, so a saved answer is still served", async () => {
    posts = [1, 2].map(i => ({ id: `lim-${i}`, channelId: "ch", status: "draft" as const, via: "buffer" as const, text: `Shipping note ${i} for builders.`, dueAt: "2026-11-02T09:00:00.000Z", sentAt: null, externalLink: null, error: null }));
    written.set("person-a", posts.map(p => ({ postId: p.id, text: `${p.text} Thrilled!`, network: "twitter" })));
    limits.blocked = "ai";
    const blocked = JSON.parse(answer(await call("list_rule_suggestions", { mode: "fixes" })));
    expect(blocked.note).toContain("Too many AI requests");
    limits.blocked = "";
    await call("list_rule_suggestions", { mode: "fixes" });
    limits.blocked = "ai";
    const saved = JSON.parse(answer(await call("list_rule_suggestions", { mode: "fixes" })));
    limits.blocked = "";
    expect(saved.suggestions).toHaveLength(1);
  });
  it("lets only one of two simultaneous checks ask the model", async () => {
    posts = [1, 2].map(i => ({ id: `race-${i}`, channelId: "ch", status: "draft" as const, via: "buffer" as const, text: `Shipping note ${i} for builders.`, dueAt: "2026-11-02T09:00:00.000Z", sentAt: null, externalLink: null, error: null }));
    written.set("person-a", posts.map(p => ({ postId: p.id, text: `${p.text} Thrilled!`, network: "twitter" })));
    let go!: () => void;
    confirm.wait = new Promise<void>(r => { go = r; });
    const before = confirm.calls;
    const both = Promise.all([call("list_rule_suggestions", { mode: "fixes" }), call("list_rule_suggestions", { mode: "fixes" })]);
    await vi.waitFor(() => expect(confirm.calls).toBe(before + 1));
    go();
    const [a, b] = (await both).map(r => JSON.parse(answer(r)));
    confirm.wait = null;
    expect(confirm.calls).toBe(before + 1);
    expect([a.suggestions.length, b.suggestions.length].sort()).toEqual([0, 1]);
    expect([a.note, b.note].join(" ")).toContain("already checking");
  });
  it("does not save an answer that skipped a repeat, so the next check asks again", async () => {
    posts = [1, 2].map(i => ({ id: `gap-${i}`, channelId: "ch", status: "draft" as const, via: "buffer" as const, text: `Shipping note ${i} for builders.`, dueAt: "2026-11-02T09:00:00.000Z", sentAt: null, externalLink: null, error: null }));
    written.set("person-a", posts.map(p => ({ postId: p.id, text: `${p.text} Thrilled!`, network: "twitter" })));
    confirm.empty = true;
    const before = confirm.calls;
    const first = JSON.parse(answer(await call("list_rule_suggestions", { mode: "fixes" })));
    confirm.empty = false;
    expect(first.note).toContain("did not answer every repeat");
    const second = JSON.parse(answer(await call("list_rule_suggestions", { mode: "fixes" })));
    expect(confirm.calls).toBe(before + 2);
    expect(second.suggestions).toHaveLength(1);
  });
  it("reuses the saved answer for the same unchanged repeats without another AI action", async () => {
    posts = [1, 2].map(i => ({ id: `reuse-${i}`, channelId: "ch", status: "draft" as const, via: "buffer" as const, text: `Shipping note ${i} for builders.`, dueAt: "2026-11-02T09:00:00.000Z", sentAt: null, externalLink: null, error: null }));
    written.set("person-a", posts.map(p => ({ postId: p.id, text: `${p.text} Thrilled!`, network: "twitter" })));
    const before = confirm.calls;
    const first = JSON.parse(answer(await call("list_rule_suggestions", { mode: "fixes" })));
    aiCalls.settle.mockClear();
    const second = JSON.parse(answer(await call("list_rule_suggestions", { mode: "fixes" })));
    expect(first.suggestions).toHaveLength(1);
    expect(second.suggestions.map((s: { key: string }) => s.key)).toEqual(first.suggestions.map((s: { key: string }) => s.key));
    expect(second.suggestions[0].token).toBeTruthy();
    expect(confirm.calls).toBe(before + 1);
    expect(aiCalls.settle).not.toHaveBeenCalled();
    posts = posts.map(p => ({ ...p, text: `${p.text} More.` }));
    vi.setSystemTime(new Date(Date.now() + 31_000));
    await call("list_rule_suggestions", { mode: "fixes" });
    expect(confirm.calls).toBe(before + 2);
  });
  it("spends no AI action when no fix repeats", async () => {
    const before = confirm.calls;
    const found = JSON.parse(answer(await call("list_rule_suggestions", { mode: "fixes" })));
    expect(found.suggestions).toHaveLength(0);
    expect(confirm.calls).toBe(before);
    expect(aiCalls.settle).not.toHaveBeenCalled();
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

describe("connector AI model", () => {
  afterEach(() => { ownKey.saved = null; ownKey.setModel.mockReset() })
  it("refuses both model tools when no key is saved, and never asks for one", async () => {
    vi.stubEnv("SETTINGS_KEY", "k".repeat(64))
    expect((await call("list_ai_models")).isError).toBe(true)
    expect((await call("set_ai_model", { model: "model-a" })).isError).toBe(true)
    expect(ownKey.setModel).not.toHaveBeenCalled()
  })
  it("lists the key's models without the key, and switches only to one of them", async () => {
    vi.stubEnv("SETTINGS_KEY", "k".repeat(64))
    ownKey.saved = { provider: "openai", key: "never-display", model: "model-a" }
    const listed = answer(await call("list_ai_models"))
    expect(JSON.parse(listed)).toEqual({ provider: "openai", selected: "model-a", models: ["model-a", "model-b"] })
    expect(listed).not.toContain("never-display")
    expect((await call("set_ai_model", { model: "not-offered" })).isError).toBe(true)
    expect(ownKey.setModel).not.toHaveBeenCalled()
    expect((await call("set_ai_model", { model: "model-b" })).isError).toBeFalsy()
    expect(ownKey.setModel).toHaveBeenCalledWith("person-a", "model-b")
  })
})

describe("connector approve", () => {
  const draft = { id: "d1", channelId: "ch", status: "draft" as const, via: "api" as const, text: "Monday post.", dueAt: "2026-11-02T09:00:00.000Z", sentAt: null, externalLink: null, error: null }
  beforeEach(() => { posts = [draft]; perm.approve.mockReset().mockResolvedValue({ approved: ["d1"], refused: [] }) })
  afterEach(() => { perm.mode = "ask" })
  it("refuses when the person turned approving from apps off", async () => {
    perm.mode = "off"
    expect((await call("approve_drafts", { postIds: ["d1"] })).isError).toBe(true)
    expect(perm.approve).not.toHaveBeenCalled()
  })
  it("asks first by default: the first call schedules nothing and names the drafts", async () => {
    const first = answer(await call("approve_drafts", { postIds: ["d1"] }))
    expect(first).toContain("Nothing approved yet")
    expect(first).toContain("Monday post.")
    expect(perm.approve).not.toHaveBeenCalled()
    const token = first.match(/confirmToken: (\S+)/)![1]
    expect((await call("approve_drafts", { postIds: ["d1", "d2"], confirmToken: token })).isError).toBe(true)
    expect((await call("approve_drafts", { postIds: ["d1"], confirmToken: token }, "person-b")).isError).toBe(true)
    expect(perm.approve).not.toHaveBeenCalled()
    expect(answer(await call("approve_drafts", { postIds: ["d1"], confirmToken: token }))).toContain("1 scheduled")
    expect(perm.approve).toHaveBeenCalledTimes(1)
  })
  it("refuses an expired confirmation", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    const token = answer(await call("approve_drafts", { postIds: ["d1"] })).match(/confirmToken: (\S+)/)![1]
    vi.setSystemTime(new Date(Date.now() + 11 * 60_000))
    expect((await call("approve_drafts", { postIds: ["d1"], confirmToken: token })).isError).toBe(true)
    expect(perm.approve).not.toHaveBeenCalled()
    vi.useRealTimers()
  })
  it("refuses an approval token after the shown draft text or time changes", async () => {
    const token = answer(await call("approve_drafts", { postIds: ["d1"] })).match(/confirmToken: (\S+)/)![1]
    posts = [{ ...draft, text: "Different content never shown for approval.", dueAt: "2026-11-03T12:00:00.000Z" }]
    const result = await call("approve_drafts", { postIds: ["d1"], confirmToken: token })
    expect(result.isError).toBe(true)
    expect(perm.approve).not.toHaveBeenCalled()
  })
  it("uses a yes once, so a draft returned to drafts cannot be scheduled again with it", async () => {
    const token = answer(await call("approve_drafts", { postIds: ["d1"] })).match(/confirmToken: (\S+)/)![1]
    await call("approve_drafts", { postIds: ["d1"], confirmToken: token })
    posts = [{ ...draft }]
    perm.approve.mockClear()
    const result = await call("approve_drafts", { postIds: ["d1"], confirmToken: token })
    expect(result.isError).toBe(true)
    expect(perm.approve).not.toHaveBeenCalled()
  })
  it("lets the same yes try again when nothing was scheduled", async () => {
    const token = answer(await call("approve_drafts", { postIds: ["d1"] })).match(/confirmToken: (\S+)/)![1]
    perm.approve.mockResolvedValueOnce({ approved: [], refused: [{ id: "d1", reason: "Buffer could not be reached." }] })
    expect((await call("approve_drafts", { postIds: ["d1"], confirmToken: token })).isError).toBe(true)
    expect(answer(await call("approve_drafts", { postIds: ["d1"], confirmToken: token }))).toContain("1 scheduled")
  })
  it("a changed setting invalidates outstanding confirmations", async () => {
    const token = answer(await call("approve_drafts", { postIds: ["d1"] })).match(/confirmToken: (\S+)/)![1]
    perm.mode = "off"
    await call("approve_drafts", { postIds: ["d1"], confirmToken: token })
    perm.mode = "ask"
    const result = await call("approve_drafts", { postIds: ["d1"], confirmToken: token })
    expect(result.isError).toBe(true)
    expect(perm.approve).not.toHaveBeenCalled()
  })
  it("shares the Buffer write allowance in both modes", async () => {
    limits.blocked = "bufferWrite"
    try {
      const token = answer(await call("approve_drafts", { postIds: ["d1"] })).match(/confirmToken: (\S+)/)![1]
      expect((await call("approve_drafts", { postIds: ["d1"], confirmToken: token })).isError).toBe(true)
      perm.mode = "direct"
      expect((await call("approve_drafts", { postIds: ["d1"] })).isError).toBe(true)
      expect(perm.approve).not.toHaveBeenCalled()
    } finally { limits.blocked = "" }
  })
  it.each(["unsure", "missing"])("refuses a %s blocking result through the real approval gate", async kind => {
    perm.mode = "direct";
    const rule: Rule = { id: "mandatory", kind: "guidance", text: "Name the change.", channels: "all", level: "block" };
    rules.set("person-a", [rule]);
    const { playbookVersion } = await import("@/lib/playbook-version");
    written.set("person-a", [{ postId: draft.id, network: "linkedin", text: draft.text, playbookRevision: playbookVersion([rule]), verdicts: kind === "missing" ? [] : [{ ruleId: rule.id, rule: rule.text, level: "block", verdict: "unsure", probability: null, quote: "", reason: "Uncertain" }] }]);
    const result = await call("approve_drafts", { postIds: [draft.id] });
    expect(result.isError).toBe(true);
    expect(perm.approve).not.toHaveBeenCalled();
  });
  it("does not release a confirmation when a scheduling response was lost", async () => {
    const token = answer(await call("approve_drafts", { postIds: ["d1"] })).match(/confirmToken: (\S+)/)![1];
    perm.approve.mockResolvedValueOnce({ approved: [], refused: [{ id: "d1", reason: "Not confirmed" }], uncertain: ["d1"] });
    await call("approve_drafts", { postIds: ["d1"], confirmToken: token });
    perm.approve.mockClear();
    const retry = await call("approve_drafts", { postIds: ["d1"], confirmToken: token });
    expect(retry.isError).toBe(true);
    expect(perm.approve).not.toHaveBeenCalled();
  });
  it("schedules in one call when the person chose not to be asked", async () => {
    perm.mode = "direct"
    expect(answer(await call("approve_drafts", { postIds: ["d1"] }))).toContain("1 scheduled")
    expect(perm.approve).toHaveBeenCalledTimes(1)
  })
})

describe("connector review links", () => {
  it("shares only the person's own drafts under a link on this site, lists the comments, and turns the link off", async () => {
    posts = [{ id: "d1", channelId: "ch", status: "draft", via: "api", text: "Day 4 of Queue Pilot.", dueAt: "2026-11-02T09:00:00.000Z", sentAt: null, externalLink: null, error: null }]
    await call("show_next_week")
    expect((await call("share_for_review", { postIds: ["not-mine"] })).isError).toBe(true)
    const shared = JSON.parse(answer(await call("share_for_review", { postIds: ["d1"] })))
    expect(shared).toMatchObject({ link: "https://app.example/r/link-1", shared: 1 })
    reviews.links[0].comments.push({ id: "c1", postId: "d1", name: "Ali", text: "just say QP", quote: "Queue Pilot", start: 9, end: 20, createdAt: "2026-10-29T12:01:00Z" })
    const listed = JSON.parse(answer(await call("list_review_comments")))
    expect(listed[0]).toMatchObject({ id: "link-1", on: true, drafts: [{ postId: "d1", comments: [{ name: "Ali", quote: "Queue Pilot", comment: "just say QP" }] }] })
    expect(JSON.parse(answer(await call("list_review_comments", {}, "person-b")))).toEqual([])
    await call("turn_off_review", { id: "link-1" }, "person-b")
    expect(reviews.links[0].revokedAt).toBeNull()
    await call("turn_off_review", { id: "link-1" })
    expect(JSON.parse(answer(await call("list_review_comments")))[0].on).toBe(false)
  })

  it("spends no AI action carrying a rule across drafts when Queue Pilot wrote none", async () => {
    const id = await ruleStore.add("person-a", { kind: "guidance", text: "Say QP.", channels: "all", level: "warn" })
    await call("show_next_week")
    expect(JSON.parse(answer(await call("propose_rule_fixes", { ruleId: id })))).toEqual({ ok: true, fixes: [], checked: 0 })
    expect(aiCalls.settle).not.toHaveBeenCalled()
  })

  it("says there are no review comments yet without an AI action", async () => {
    const r = JSON.parse(answer(await call("list_rule_suggestions", { mode: "comments" })))
    expect(r.note).toContain("No review comments yet")
    expect(aiCalls.settle).not.toHaveBeenCalled()
  })
})


describe("comment to draft changes through the real connector", () => {
  async function prepare() {
    posts = ["d1", "d2"].map(id => ({ id, channelId: "ch", status: "draft", via: "api", text: "Launch is Monday.", dueAt: "2026-11-02T09:00:00.000Z", sentAt: null, externalLink: null, error: null }));
    written.set("person-a", posts.map(p => ({ postId: p.id, network: "linkedin", text: p.text })));
    await call("show_next_week");
    await call("share_for_review", { postIds: ["d1", "d2"] });
    reviews.links[0].comments.push({ id: "comment", postId: "d1", name: "Reviewer", text: "It is Tuesday, not Monday.", quote: "Monday", start: 10, end: 16, createdAt: "2026-10-29T12:01:00Z" });
  }
  it("a fact offers two changes, no rule, and refuses overwriting a newer Buffer edit", async () => {
    await prepare();
    feedbackAnswer.value = { kind: "fact", reason: "Date correction", preference: null, edits: [1, 2].map(draft => ({ draft, text: "Launch is Tuesday.", reason: "Corrected day" })) };
    const response = await call("propose_review_changes", { linkId: "link-1", commentId: "comment", postIds: ["d1", "d2"] });
    expect(response.isError).not.toBe(true);
    const { plan } = JSON.parse(answer(response));
    expect(plan).toMatchObject({ kind: "fact", suggestionToken: null, checked: 0, check: "no-rules" });
    expect(plan.edits).toHaveLength(2);
    expect(posts[0].text).toBe("Launch is Monday.");
    expect(rules.get("person-a") ?? []).toEqual([]);
    const first = plan.edits[0];
    expect((await call("update_draft", { postId: first.postId, text: first.after, expectedText: first.before })).isError).not.toBe(true);
    expect(posts[0].text).toBe("Launch is Tuesday.");
    posts[1].text = "Launch date is not decided.";
    const refused = await call("update_draft", { postId: "d2", text: "Launch is Tuesday.", expectedText: "Launch is Monday." });
    expect(refused.isError).toBe(true);
    expect(posts[1].text).toBe("Launch date is not decided.");
  });
  it("a preference is only kept by a separate call, scoped to its selected account", async () => {
    await prepare();
    feedbackAnswer.value = { kind: "preference", reason: "Explicit future preference", preference: "Use short openings.", edits: [] };
    const { plan } = JSON.parse(answer(await call("propose_review_changes", { linkId: "link-1", commentId: "comment", postIds: ["d1"] })));
    expect(rules.get("person-a") ?? []).toEqual([]);
    expect((await call("keep_suggestion", { token: plan.suggestionToken }, "person-b")).isError).toBe(true);
    expect((await call("keep_suggestion", { token: plan.suggestionToken })).isError).not.toBe(true);
    expect(rules.get("person-a")).toMatchObject([{ accountIds: ["ch"], text: "Use short openings." }]);
    const effective = JSON.parse(answer(await call("get_effective_rules", { channelId: "ch" })));
    expect(effective.rules[0]).toMatchObject({ applies: true, origin: "account" });
    expect((await call("get_effective_rules", { channelId: "foreign" })).isError).toBe(true);
  });
  it("rejects another person's comment and unwritten drafts before spending AI", async () => {
    await prepare();
    expect((await call("propose_review_changes", { linkId: "link-1", commentId: "comment", postIds: ["d1"] }, "person-b")).isError).toBe(true);
    written.clear();
    expect((await call("propose_review_changes", { linkId: "link-1", commentId: "comment", postIds: ["d1"] })).isError).toBe(true);
    expect(aiCalls.settle).not.toHaveBeenCalled();
  });
});


describe("source evidence connector", () => {
  it("marks source reporting as a write and binds provenance to the authenticated app", async () => {
    const response = await rpc("tools/list", {});
    expect(response.result.tools.find((t: { name: string }) => t.name === "report_source_version").annotations.readOnlyHint).toBe(false);
    sourceCalls.list.mockResolvedValue([{ sourceKey: "feed:item", uri: "https://example.com/post", evidence: [{ postId: "post-a" }] }]);
    const r = await call("report_source_version", { sourceKey: "feed:item", uri: "https://example.com/post", text: "The export limit is 1000.", checkedBy: "someone-else", userId: "person-b" });
    expect(r.isError).not.toBe(true);
    expect(sourceCalls.report).toHaveBeenCalledWith("person-a", expect.objectContaining({ checkedBy: "ai:test-client", text: "The export limit is 1000." }), expect.any(Function));
  });
  it("rejects unknown source keys and substituted source URLs before checking", async () => {
    const input = { sourceKey: "feed:item", uri: "https://example.com/post", text: "Updated source." };
    expect((await call("report_source_version", input)).isError).toBe(true);
    sourceCalls.list.mockResolvedValue([{ sourceKey: "feed:item", uri: "https://example.com/real", evidence: [] }]);
    expect((await call("report_source_version", input)).isError).toBe(true);
    expect(sourceCalls.report).not.toHaveBeenCalled();
  });
  it("returns pending transcripts without saving a draft or calling the writer", async () => {
    const r = await call("get_transcript", { url: "https://youtube.com/watch?v=abcdefghijk" });
    expect(JSON.parse(answer(r))).toEqual({ status: "pending", jobId: "job-1" });
    expect(sourceCalls.transcript).toHaveBeenCalledWith("person-a", "https://youtube.com/watch?v=abcdefghijk");
    expect(posts).toHaveLength(0);
    expect(aiCalls.settle).not.toHaveBeenCalled();
  });
});


describe("source evidence persistence", () => {
  it("does not grant QP ownership when evidence recording fails after Buffer saves", async () => {
    const store = await import("@/lib/source-store");
    vi.mocked(store.recordEvidence).mockRejectedValueOnce(new Error("storage unavailable"));
    const slotId = answer(await call("list_open_slots")).match(/ch@[^ ]+/)![0];
    const result = await call("save_drafts", { title: "Release", drafts: [{ slotId, text: "CSV export is live.", snapshotId: "snapshot-test", evidence: [{ claim: "CSV export is live.", quote: "CSV export is live." }] }] });
    expect(result.isError).not.toBe(true);
    expect(posts).toHaveLength(1);
    expect(answer(result)).toContain("evidence could not be recorded");
    expect(written.get("person-a") ?? []).toHaveLength(0);
    expect(buffer.calls.some(c => /schedulePost|publishPost/.test(c.query))).toBe(false);
  });
});


it("returns citations without repeating entire source documents for each draft", async () => {
  const { sourceCards } = await import("@/lib/source-presentation");
  posts = [{ id: "p", channelId: "ch", text: "CSV export is live.", status: "draft", dueAt: "2026-11-02T09:00:00.000Z", sentAt: null, externalLink: null, error: null }];
  written.set("person-a", [{ postId: "p", text: posts[0].text, network: "linkedin" }]);
  vi.mocked(sourceCards).mockResolvedValueOnce([{ postId: "p", snapshotId: "s", title: "Release", uri: "https://example.com", claim: "CSV export is live.", quote: "CSV export is live.", locator: null, lastCheckedAt: "2026-11-01", needsCheck: false, changed: false, scheduled: false, editable: true, oldText: "FULL OLD DOCUMENT", newText: "FULL NEW DOCUMENT", draftText: posts[0].text, why: "Quote matches" }]);
  const response = answer(await call("list_my_drafts"));
  expect(response).toContain('"quote": "CSV export is live."');
  expect(response).not.toContain("FULL OLD DOCUMENT");
  expect(response).not.toContain("FULL NEW DOCUMENT");
});

it("describes transcript acquisition as a write-capable credit-spending operation", async () => {
 const response = await rpc("tools/list", {});
 expect(response.result.tools.find((t: { name: string }) => t.name === "get_transcript").annotations.readOnlyHint).toBe(false);
});

it("read_material returns the video description when captions are unavailable", async () => {
 vi.mocked(safeFetch).mockImplementation(async () => new Response(releaseXml.replace("https://example.com/releases/v2", "https://youtube.com/watch?v=abcdefghijk")));
 await call("add_source", { url: "https://example.com/feed" });
 const key = answer(await call("list_new_material")).match(/key: (.+)/)![1];
 sourceCalls.transcript.mockResolvedValueOnce({ status: "not-configured", message: "No key" } as never);
 const result = JSON.parse(answer(await call("read_material", { key })));
 expect(result).toMatchObject({ kind: "video-description", text: "CSV export is live. Includes archived rows.", snapshotId: "snapshot-test", transcriptStatus: "not-configured" });
 expect(result.title).toContain("description only");
});

it("returns complete podcasts with the closing timestamp rather than an opening excerpt", async () => {
 const full = "Background. ".repeat(3000) + "Closing evidence.";
 sourceCalls.transcript.mockResolvedValueOnce({ status: "ready", text: full, truncated: false, captions: "unknown", segments: [{ text: "Closing evidence.", seconds: 7190 }] } as never);
 const result = JSON.parse(answer(await call("get_transcript", { url: "https://youtube.com/watch?v=abcdefghijk" })));
 expect(result).toMatchObject({ text: full, truncated: false, snapshotId: "snapshot-test", coverage: { fullTranscriptSaved: true, lastCaptionSeconds: 7190, selection: null } });
});
it("reads a closing passage from this account's saved snapshot without another paid fetch", async () => {
 const result = JSON.parse(answer(await call("get_transcript", { url: "https://youtu.be/abcdefghijk", snapshotId: "saved-podcast", startSeconds: 7190 })));
 expect(result).toMatchObject({ text: "Closing evidence.", snapshotId: "saved-podcast", coverage: { fullTranscriptSaved: true } });
 expect(sourceCalls.transcript).not.toHaveBeenCalled();
 expect((await call("get_transcript", { url: "https://youtu.be/abcdefghijk", snapshotId: "saved-podcast", startSeconds: 7190 }, "person-b")).isError).toBe(true);
 expect((await call("get_transcript", { url: "https://youtu.be/different123", snapshotId: "saved-podcast" })).isError).toBe(true);
});
it("searches the web through the operator's Exa key and never saves anything", async () => {
 exaState.search.mockResolvedValueOnce({ status: "ready", results: [{ title: "T", url: "https://example.com/a", publishedDate: null, author: null, excerpts: ["short"] }] });
 const result = JSON.parse(answer(await call("search_context", { query: "export limits", numResults: 3 })));
 expect(result.results[0].url).toBe("https://example.com/a");
 expect(exaState.search).toHaveBeenCalledWith({ query: "export limits", numResults: 3 }, "exa-test");
 expect(await material.list("person-a")).toHaveLength(0);
});
it("says plainly when no Exa key is set", async () => {
 exaState.key = null;
 await call("search_context", { query: "anything" });
 expect(exaState.search).toHaveBeenLastCalledWith({ query: "anything" }, "");
 exaState.key = "exa-test";
});
it("keeps a read web page whole as a source snapshot with its link, for evidence", async () => {
 exaState.page.mockResolvedValueOnce({ status: "ready", page: { title: "Release notes", url: "https://example.com/notes#top", text: "Exports allow 1,000 rows.", truncated: false } });
 const result = JSON.parse(answer(await call("add_web_page", { url: "https://example.com/notes" })));
 expect(result).toMatchObject({ status: "saved", snapshotId: "snapshot-test", link: "https://example.com/notes#top", text: "Exports allow 1,000 rows.", truncated: false });
 expect(await material.list("person-a")).toHaveLength(0);
});
it("returns a page longer than the old material limit without cutting its ending", async () => {
 const episode = `${"Host: question. Guest: answer. ".repeat(3000)}Guest: and that is the final correction.`;
 exaState.page.mockResolvedValueOnce({ status: "ready", page: { title: "Episode", url: "https://example.com/ep", text: episode, truncated: false } });
 const result = JSON.parse(answer(await call("add_web_page", { url: "https://example.com/ep" })));
 expect(result.characters).toBe(episode.length);
 expect(result.text.endsWith("final correction.")).toBe(true);
 expect(result.truncated).toBe(false);
});
it("tells the AI when a page passed the size ceiling and stores it as an excerpt, never as the whole", async () => {
 exaState.page.mockResolvedValueOnce({ status: "ready", page: { title: "Huge", url: "https://example.com/huge", text: "Opening of a huge page.", truncated: true } });
 expect(JSON.parse(answer(await call("add_web_page", { url: "https://example.com/huge" })))).toMatchObject({ status: "saved", truncated: true });
 expect(sourceCalls.captured.at(-1)).toEqual([expect.objectContaining({ sourceKey: "web:https://example.com/huge", uri: "https://example.com/huge" }), { truncated: true }]);
});
it("stores a complete page as complete, under its address without the fragment", async () => {
 exaState.page.mockResolvedValueOnce({ status: "ready", page: { title: "Notes", url: "https://example.com/notes#top", text: "Whole page.", truncated: false } });
 await call("add_web_page", { url: "https://example.com/notes" });
 expect(sourceCalls.captured.at(-1)).toEqual([expect.objectContaining({ sourceKey: "web:https://example.com/notes", uri: "https://example.com/notes" }), { truncated: false }]);
});
it("sends the AI from search_context to add_web_page and its snapshotId, not to read_material", async () => {
 const tools = (await rpc("tools/list", {})).result.tools as { name: string; description: string }[];
 const description = tools.find((t) => t.name === "search_context")!.description;
 expect(description).toContain("add_web_page");
 expect(description).toContain("snapshotId");
 expect(description).not.toContain("read_material");
});
it("saves nothing when the page cannot be read", async () => {
 const result = JSON.parse(answer(await call("add_web_page", { url: "https://example.com/gone" })));
 expect(result.status).toBe("failed");
 expect(await material.list("person-a")).toHaveLength(0);
});
it("rejects a search or page address that is not a web address", async () => {
 expect((await call("add_web_page", { url: "javascript:alert(1)" })).isError).toBe(true);
 expect((await call("search_context", { query: "x", category: "videos" })).isError).toBe(true);
 expect((await call("search_context", { query: "x", numResults: 50 })).isError).toBe(true);
});
it("marks the Exa tools as not read-only, because they spend credits", async () => {
 const response = await rpc("tools/list", {});
 for (const name of ["search_context", "add_web_page"]) expect(response.result.tools.find((t: { name: string }) => t.name === name).annotations.readOnlyHint).toBe(false);
});
it("rejects a backwards time range before spending transcript credits", async () => {
 expect((await call("get_transcript", { url: "https://youtu.be/abcdefghijk", startSeconds: 7190, endSeconds: 12 })).isError).toBe(true);
 expect(sourceCalls.transcript).not.toHaveBeenCalled();
});


describe("saved source validation without transcript round-trip", () => {
  const input = { sourceKey: "yt:abcdefghijk", uri: "https://youtube.com/watch?v=abcdefghijk", snapshotId: "long-podcast" };
  beforeEach(() => sourceCalls.list.mockResolvedValue([{ sourceKey: input.sourceKey, uri: input.uri, evidence: [{ postId: "post-a" }] }]));
  it("passes the full stored transcript and asks for a first semantic check", async () => {
    const result = await call("report_source_version", input);
    expect(result.isError).not.toBe(true);
    expect(sourceCalls.report).toHaveBeenCalledWith("person-a", expect.objectContaining({ text: "Whole transcript. ".repeat(5000) + "Closing evidence.", expectedSnapshotId: "long-podcast", validateUnchanged: true }), expect.any(Function), expect.objectContaining({ kind: "transcript" }));
    expect(JSON.parse(answer(result))).toMatchObject({ checkedAgainst: "saved-source" });
  });
  it("rejects another account's snapshot and a mismatched source before inference", async () => {
    expect((await call("report_source_version", input, "person-b")).isError).toBe(true);
    sourceCalls.list.mockResolvedValue([{ sourceKey: "different", uri: input.uri, evidence: [] }]);
    expect((await call("report_source_version", { ...input, sourceKey: "different" })).isError).toBe(true);
    expect(sourceCalls.report).not.toHaveBeenCalled();
  });
  it("rejects ambiguous and missing source content", async () => {
    expect((await call("report_source_version", { ...input, text: "partial" })).isError).toBe(true);
    const { snapshotId: _id, ...missing } = input;
    expect((await call("report_source_version", missing)).isError).toBe(true);
    expect(sourceCalls.report).not.toHaveBeenCalled();
  });
});


it("exposes exact evidence wording and repairs an existing owned draft without a Buffer write", async () => {
 const tools = (await rpc("tools/list", {})).result.tools;
 for (const name of ["save_drafts", "update_draft"]) {
   const tool = tools.find((t: { name: string }) => t.name === name);
   const evidence = name === "save_drafts" ? tool.inputSchema.properties.drafts.items.properties.evidence : tool.inputSchema.properties.evidence;
   expect(evidence.items.properties.claim.description).toContain("Do not paraphrase");
   expect(evidence.items.properties.quote.description).toContain("word for word");
 }
 posts = [{ id: "repair", channelId: "ch", text: "CSV export is live.", status: "draft", via: "api", dueAt: "2026-11-02T09:00:00Z", sentAt: null, externalLink: null, error: null }];
 written.set("person-a", [{ postId: "repair", network: "linkedin", text: posts[0].text }] as Written[]);
 const args = { postId: "repair", text: posts[0].text, expectedText: posts[0].text, snapshotId: "snapshot-test", evidence: [{ claim: posts[0].text, quote: posts[0].text }] };
 const before = structuredClone(posts);
 expect((await call("update_draft", args)).isError).not.toBe(true);
 expect(sourceCalls.repair).toHaveBeenCalledWith("person-a", "repair", posts[0].text, "snapshot-test", args.evidence);
 expect(posts).toEqual(before);
 sourceCalls.repair.mockClear();
 expect((await call("update_draft", args, "person-b")).isError).toBe(true);
 expect((await call("update_draft", { ...args, expectedText: undefined })).isError).toBe(true);
 expect(sourceCalls.repair).not.toHaveBeenCalled();
});
