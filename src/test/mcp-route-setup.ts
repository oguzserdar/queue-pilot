/**
 * @fileoverview Shared setup for the MCP route tests (src/app/api/mcp/route-*.test.ts): the mocked modules, the
 * in-memory stores, the fake Buffer, and the helpers that call the real route as a connected AI app would. Import it
 * first in each file, before any app module, so the mocks are registered before the route and its modules load.
 */
import { afterEach, beforeEach, vi } from "vitest"
import type { Written } from "@/lib/written-store"
import type { Rule } from "@/lib/rules"
import { fakeBuffer } from "@/test/fake-buffer"
import { answering, deciding } from "@/lib/ai-test-model"
const exaState = vi.hoisted(() => ({ key: "exa-test" as string | null, search: vi.fn<typeof import("@/lib/exa").searchWeb>(async () => ({ status: "ready", results: [] })), page: vi.fn<typeof import("@/lib/exa").readPage>(async () => ({ status: "failed", message: "Exa could not read that page." })) }));
vi.mock("@/lib/exa", async (original) => ({ ...await original<typeof import("@/lib/exa")>(), searchWeb: (...a: Parameters<typeof import("@/lib/exa").searchWeb>) => exaState.search(...a), readPage: (...a: Parameters<typeof import("@/lib/exa").readPage>) => exaState.page(...a) }));
vi.mock("@/lib/env", async (original) => ({ ...await original<typeof import("@/lib/env")>(), exaKey: async () => exaState.key }));
const sourceCalls = vi.hoisted(() => ({ captured: [] as unknown[][], repair: vi.fn<typeof import("@/lib/source-store").replaceDraftEvidence>(async () => {}), list: vi.fn<typeof import("@/lib/source-check").listSourcesToCheck>(async () => []), report: vi.fn<typeof import("@/lib/source-check").reportSourceVersion>(async () => ({ changed: true, pending: 0 }) as Awaited<ReturnType<typeof import("@/lib/source-check").reportSourceVersion>>), transcript: vi.fn<typeof import("@/lib/transcript-for-user").transcriptForUser>(async () => ({ status: "pending", jobId: "job-1" })) }));
vi.mock("@/lib/source-check", () => ({ listSourcesToCheck: (...a: Parameters<typeof import("@/lib/source-check").listSourcesToCheck>) => sourceCalls.list(...a), reportSourceVersion: (...a: Parameters<typeof import("@/lib/source-check").reportSourceVersion>) => sourceCalls.report(...a) }));
vi.mock("@/lib/transcript-for-user", () => ({ transcriptForUser: (...a: Parameters<typeof import("@/lib/transcript-for-user").transcriptForUser>) => sourceCalls.transcript(...a) }));
vi.mock("@/lib/source-store", () => ({ latestSource: async () => ({ id: "snapshot-test" }), captureSource: async (_u: string, data: { text: string }, metadata: unknown = {}) => { sourceCalls.captured.push([data, metadata]); return { id: "snapshot-test", ...data, metadata }; }, sourceById: async (user: string, id: string) => { if (!["saved-podcast", "long-podcast"].includes(id)) return ({ text: "CSV export is live. Includes archived rows.", metadata: {} }); return user === "person-a" ? { id, sourceKey: "yt:abcdefghijk", uri: "https://youtube.com/watch?v=abcdefghijk", text: id === "long-podcast" ? "Whole transcript. ".repeat(5000) + "Closing evidence." : "Intro. Closing evidence.", metadata: { kind: "transcript", truncated: false, segments: [{ text: "Intro.", seconds: 0 }, { text: "Closing evidence.", seconds: 7190 }] } } : null }, recordEvidence: vi.fn<typeof import("@/lib/source-store").recordEvidence>(async () => {}), replaceDraftEvidence: (...a: Parameters<typeof import("@/lib/source-store").replaceDraftEvidence>) => sourceCalls.repair(...a), sourceHoldsForPosts: async () => new Map() }));
vi.mock("@/lib/source-presentation", () => ({ sourceCards: vi.fn<typeof import("@/lib/source-presentation").sourceCards>(async () => []) }));

const ownKey = vi.hoisted(() => ({ saved: null as null | { provider: string, key: string, model: string }, setModel: vi.fn<ReturnType<typeof import("@/lib/ai-key-store").postgresAiKeyStore>["setModel"]>() }))
vi.mock("@/lib/ai-key-store", async (orig) => ({
  ...(await orig<object>()),
  postgresAiKeyStore: () => ({ get: async () => ownKey.saved, setModel: ownKey.setModel }),
}))
vi.mock("@/lib/ai-models", async (orig) => ({ ...(await orig<object>()), listModels: async () => ({ models: [{ id: "model-a" }, { id: "model-b" }] }) }))
// Saving the setting gives it a new revision, as the real table's updated_at does; claims are kept in memory.
const perm = vi.hoisted(() => {
  let mode: "ask" | "direct" | "off" = "ask", revision = 0
  return { get mode() { return mode }, set mode(m) { mode = m; revision++ }, get revision() { return String(revision) }, approve: vi.fn<typeof import("@/lib/approve-drafts").approveDrafts>(), claims: new Set<string>() }
})
vi.mock("@/lib/agent-permission", async (orig) => ({
  ...(await orig<object>()),
  approveMode: async () => perm.mode,
  approvePermission: async () => ({ mode: perm.mode, revision: perm.revision }),
  claimApproval: async (_u: string, nonce: string) => (perm.claims.has(nonce) ? false : (perm.claims.add(nonce), true)),
  releaseApproval: async (_u: string, nonce: string) => { perm.claims.delete(nonce) },
}))
vi.mock("@/lib/approve-drafts", async (orig) => ({ ...(await orig<object>()), approveDrafts: (...a: Parameters<typeof import("@/lib/approve-drafts").approveDrafts>) => perm.approve(...a) }))
vi.mock("@/db", () => ({ db: () => { throw new Error("Unexpected database call") } }))
vi.mock("@/lib/auth", () => ({ getAuth: async () => ({ $context: Promise.resolve({ baseURL: "https://app.example/api/auth" }) }), mcpResource: (url: string) => `${url}/api/mcp` }))
vi.mock("@better-auth/mcp", () => ({
  requireMcpAuth: (_auth: unknown, handler: (req: Request, claims: { sub?: string, azp: string }) => Promise<Response>) => (req: Request) => {
    const sub = req.headers.get("authorization")?.replace("Bearer ", "")
    return sub ? handler(req, { sub, azp: "test-client" }) : new Response("Unauthorized", { status: 401 })
  },
}))
const approval = vi.hoisted(() => ({ state: { state: "approved" } as { state: "approved" } | { state: "unused"; consentId: string } | { state: "none" }, revoke: vi.fn<typeof import("@/lib/ai-access").revokeApp>(async () => true) }));
vi.mock("@/lib/ai-access", () => ({ approvalState: async () => approval.state, revokeApp: approval.revoke, UNUSED_DAYS: 30, recordAppUse: async () => {}, approvedApps: async () => [{ name: "ChatGPT", lastUsedAt: "2026-10-29T12:00:00Z" }], connectedApp: async () => ({ name: "ChatGPT", verified: true }) }))
// Security activity: each consequential action, with who did it, kept in memory.
const actionLog = vi.hoisted(() => [] as { userId: string; kind: string; by: unknown; facts: unknown }[])
vi.mock("@/lib/security-events", async (orig) => ({ draftSlot: (await orig<typeof import("@/lib/security-events")>()).draftSlot, recordAction: async (userId: string, kind: string, by: unknown, facts: unknown) => { actionLog.push({ userId, kind, by, facts }) } }))
export const lastAction = (kind: string) => actionLog.filter((a) => a.kind === kind).at(-1)
const limits = vi.hoisted(() => ({ blocked: "" }));
vi.mock("@/lib/rate-limit", () => ({ limit: async (kind: string) => ({ ok: kind !== limits.blocked }), limitHeaders: () => ({}) }))
// "no-buffer" signed up with email: the real "no Buffer account" error, as the token helper throws it.
vi.mock("@/lib/buffer-token", async (orig) => {
  const real = await orig<typeof import("@/lib/buffer-token")>()
  return { ...real, bufferAccessToken: async (_auth: unknown, userId: string) => { if (userId === "no-buffer") throw new real.NoBufferAccount(); return userId } }
})
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
// Pulled-back marks live in the database (pulled-back.test.ts); none here unless a test sets them.
export const pulledBackIds = new Set<string>()
vi.mock("@/lib/pulled-back", () => ({ pulledBackFor: async () => new Set(pulledBackIds), postgresPulledBackStore: () => ({ list: async () => pulledBackIds, apply: async () => {} }) }))
// The two rule-scope writes run on the real database in postgres-stores.test.ts; here only their answers are checked.
vi.mock("@/lib/rule-routing-store", async original => ({ ...await original<typeof import("@/lib/rule-routing-store")>(), setInheritance: vi.fn<typeof import("@/lib/rule-routing-store").setInheritance>(async () => true), setRuleOverride: vi.fn<typeof import("@/lib/rule-routing-store").setRuleOverride>(async () => true) }))
vi.mock("@/lib/rules-store", async original => ({ ...await original<typeof import("@/lib/rules-store")>(), postgresRulesStore: () => ruleStore }))
vi.mock("@/lib/written-store", () => ({
  postgresWrittenStore: () => ({ get: async (id: string, ids: string[]) => (written.get(id) ?? []).filter(w => ids.includes(w.postId)), record: async (id: string, drafts: Written[]) => written.set(id, [...(written.get(id) ?? []), ...drafts]), recordCheck: async (id: string, checks: { postId: string; text: string; verdicts: Written["verdicts"]; playbookRevision: string | null }[]) => written.set(id, (written.get(id) ?? []).map((w) => { const c = checks.find((x) => x.postId === w.postId); return c ? { ...w, checkedText: c.text, verdicts: c.verdicts, playbookRevision: c.playbookRevision } : w; })) }),
  wroteIds: async (id: string, ...ids: string[]) => new Set((written.get(id) ?? []).filter((p) => ids.includes(p.postId)).map((p) => p.postId)),
  hasApprovedDraft: async (id: string) => (written.get(id) ?? []).some((w) => !!w.approvedAt),
}))
vi.mock("@/lib/buffer/client", async (original) => ({ ...await original<typeof import("@/lib/buffer/client")>(), bufferQuery: (...args: Parameters<typeof import("@/lib/buffer/client").bufferQuery>) => buffer.q(...args) }))
vi.mock("@/lib/safe-fetch", () => ({ safeFetch: vi.fn<typeof import("@/lib/safe-fetch").safeFetch>(), BlockedAddressError: class extends Error {} }))
const confirm = vi.hoisted(() => ({ verdict: "preference" as "preference" | "fact", calls: 0, empty: false, wait: null as Promise<void> | null }));
vi.mock("@/lib/confirm-fixes", async (original) => ({ ...await original<typeof import("@/lib/confirm-fixes")>(), askVerdicts: async (_model: unknown, offers: object[]) => { confirm.calls++; if (confirm.wait) await confirm.wait; if (confirm.empty) return []; return offers.map((_o, i) => ({ candidate: i + 1, verdict: confirm.verdict, why: "Both drafts make the same change.", rule: confirm.verdict === "preference" ? "Keep the same change." : "" })); } }));
const savedVerdicts = vi.hoisted(() => new Map<string, unknown>());
vi.mock("@/lib/fix-verdicts", async (original) => ({ ...await original<typeof import("@/lib/fix-verdicts")>(), postgresVerdictStore: () => ({
  get: async (u: string, k: string) => { const v = savedVerdicts.get(`${u}|${k}`); if (v === undefined) return null; return typeof v === "string" ? { kind: "busy" } : { kind: "answer", verdicts: v }; },
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
const aiCalls = vi.hoisted(() => ({ settle: vi.fn<import("@/lib/judge-model").Ai["settle"]>(async () => {}), giveBack: vi.fn<import("@/lib/judge-model").Ai["giveBack"]>(async () => {}) }));
vi.mock("@/lib/judge-model", () => ({ AiCapError: class extends Error {}, allowanceFor: async () => ({ used: 1, cap: 20, budgetUsd: 100, leftUsd: 99.95, totalRemaining: 100 }), aiFor: async () => ({ cfg: { provider: "openai", key: "never-display", model: "test" }, language: answering({ quote: "broth", reason: "Use stock." }), decider: judge.model, source: "Queue Pilot key", ...aiCalls }), judgeModelFor: async () => ({
  language: answering(feedbackAnswer.value),
  judges: { decider: judge.model, explainer: answering({ quote: "broth", reason: "Use stock." }) },
  source: "your key", cfg: { provider: "openai" }, ...aiCalls,
}) }))

export const { memoryVoiceStore, MAX_EXAMPLES, MAX_NOTE, MAX_PASTED_TEXT } = await import("@/lib/voice-store")
export const { memorySourceStore } = await import("@/lib/sources-store")
export const { memoryMaterialStore } = await import("@/lib/material-store")
export const { memorySnapshotStore } = await import("@/lib/buffer/snapshot")
export const { safeFetch } = await import("@/lib/safe-fetch")
export const { POST } = await import("@/app/api/mcp/route")
export const { newMaterial } = await import("@/lib/new-material")
// The fake Buffer imports app modules, so it loads after the mocks above are in place.
const { fakeAnswer, setPosts, nextSerial } = await import("./fake-buffer-api")
export let voices = memoryVoiceStore()
export let sources = memorySourceStore()
export let material = memoryMaterialStore()
export let snapshots = memorySnapshotStore()
export const written = new Map<string, Written[]>()
export const rules = new Map<string, Rule[]>()
export const dismissed = new Map<string, Set<string>>()
export const ruleStore = {
  list: async (id: string) => rules.get(id) ?? [],
  add: async (id: string, rule: import("@/lib/rules").NewRule, fixes = 0) => { const key = `rule-${nextSerial()}`; rules.set(id, [...(rules.get(id) ?? []), { ...rule, id: key, fixes } as Rule & { fixes: number }]); return key },
  remove: async (id: string, key: string) => { rules.set(id, (rules.get(id) ?? []).filter(r => r.id !== key)) },
  dismissed: async (id: string) => dismissed.get(id) ?? new Set<string>(),
  dismiss: async (id: string, key: string) => { const mine = dismissed.get(id) ?? new Set<string>(); mine.add(key); dismissed.set(id, mine) },
}
export const judge = deciding((ids, state) => Object.fromEntries(ids.map((id) => [id, { type: "choice", choice: state.includes("broth") ? "fail" : "pass" }])))
export const buffer = fakeBuffer(fakeAnswer)

export const releaseXml = `<feed xmlns="http://www.w3.org/2005/Atom"><title>Releases</title><id>releases</id><updated>2026-10-29T12:00:00Z</updated><entry><id>v2</id><title>v2</title><updated>2026-10-29T12:00:00Z</updated><link href="https://example.com/releases/v2"/><content type="html">&lt;p&gt;CSV export is live. Includes archived rows.&lt;/p&gt;</content></entry></feed>`
export type Result = { content: { type: string, text: string }[], isError?: boolean, structuredContent?: Record<string, unknown> }
export async function rpc(method: string, params: Record<string, unknown>, userId = "person-a") {
  const res = await POST(new Request("https://app.example/api/mcp", {
    method: "POST", headers: { authorization: `Bearer ${userId}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: nextSerial(), method, params }),
  }))
  const body = await res.text()
  const json = JSON.parse(body.trim().startsWith("{") ? body : body.split("\n").find((line) => line.startsWith("data:"))!.slice(5))
  return json
}
/** Tools that answered at least once without an error and with typed data, which the SDK checked against their schema. */
export const typedSuccess = new Set<string>()
export async function call(name: string, args: Record<string, unknown> = {}, userId = "person-a"): Promise<Result> {
  const json = await rpc("tools/call", { name, arguments: args }, userId)
  if (!json.error && !json.result?.isError && json.result?.structuredContent) typedSuccess.add(name)
  return json.error ? { isError: true, content: [{ type: "text", text: JSON.stringify(json.error) }] } : json.result
}
export const answer = (r: Result) => r.content.map((c) => c.text).join("\n")
// Whether a tool call failed, with its answer, so a failed assertion shows what the tool said.
export const outcome = (r: Result) => ({ isError: Boolean(r.isError), answer: answer(r) })

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
  setPosts([])
  buffer.calls.length = 0
  buffer.limitCalls.length = 0
  vi.mocked(safeFetch).mockImplementation(async () => new Response(releaseXml))
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs() })

/** Tools still without an output schema; lowered as each file gets typed results, never raised. */
export const UNTYPED_TOOLS_LEFT = 0
/** Replaces the snapshot store, as a fresh read of Buffer would. */
export function setSnapshots(next: typeof snapshots) { snapshots = next }
// Values made with vi.hoisted are exported here: vitest cannot hoist an exported declaration.
export { exaState, sourceCalls, ownKey, perm, approval, actionLog, limits, attemptStore, confirm, savedVerdicts, reviews, feedbackAnswer, aiCalls }
