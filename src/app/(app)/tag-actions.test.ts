/**
 * @fileoverview The draft window's tags: sign-in required, only posts in the person's own queue, changes only on drafts
 * Queue Pilot wrote, and only the organization's own tags.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/current-user", () => ({ bufferForReading: vi.fn() }))
vi.mock("@/db", () => ({ db: () => { throw new Error("Unexpected database call") } }))
vi.mock("@/lib/rate-limit", () => ({ limit: vi.fn(async () => ({ ok: true })) }))
vi.mock("@/lib/written-store", () => ({ wroteIds: vi.fn(async () => new Set(["mine"])) }))
const buffer = { answer: (() => ({})) as (query: string, variables: Record<string, unknown>) => unknown }
vi.mock("@/lib/buffer/client", async (original) => ({ ...await original<typeof import("@/lib/buffer/client")>(), bufferQuery: async (_t: string, q: string, v: Record<string, unknown>) => { const a = buffer.answer(q, v); if (a instanceof Error) throw a; return a } }))

const { bufferForReading } = await import("@/lib/current-user")
const { wroteIds } = await import("@/lib/written-store")
const { limit } = await import("@/lib/rate-limit")
const { readDraftTags, setTagsOnDraft, createTagForDraft } = await import("./tag-actions")

const draft = { id: "mine", channelId: "ch", status: "draft", text: "Soup night.", dueAt: null, sentAt: null, externalLink: null, error: null }
const soups = { id: "t1", name: "Soups", color: "#8F2457", isLocked: false }
const tagsPage = { tagsV2: { edges: [{ node: soups }], pageInfo: { hasNextPage: false, endCursor: null } } }
const signedIn = (posts: unknown[] = [draft]) => vi.mocked(bufferForReading).mockResolvedValue({ userId: "person-a", token: "tok", posts, channels: [{ id: "ch", organizationId: "org" }], teamSizes: {} } as never)

/** A fake Buffer that answers tags, a post's tags, the fresh draft read and the edit, and records every edit. */
function fakeBuffer(edits: unknown[] = []) {
  buffer.answer = (q, v) => {
    if (q.includes("tagsV2")) return tagsPage
    if (q.includes("PostTags")) return { post: { tags: [{ id: "t1", name: "Soups", color: "#8F2457" }] } }
    if (q.includes("DraftForTags")) return { post: { id: "mine", text: "Soup night.", status: "draft" } }
    if (q.includes("editPost")) { edits.push(v); return { editPost: { __typename: "PostActionSuccess" } } }
    if (q.includes("createTag")) return { createTag: { __typename: "TagActionSuccess", tag: { id: "t2", name: "Weeknight", color: "#8F2457", isLocked: false } } }
    throw new Error(`Unexpected query: ${q}`)
  }
  return edits
}

beforeEach(() => { vi.clearAllMocks(); signedIn(); vi.mocked(wroteIds).mockResolvedValue(new Set(["mine"])) })

describe("readDraftTags", () => {
  it("requires sign-in and never asks Buffer about a post outside the person's queue", async () => {
    const asked = vi.fn()
    buffer.answer = (q) => { asked(q); return {} }
    expect(await readDraftTags("someone-elses")).toEqual({ ok: false, message: "This post is not in your queue." })
    vi.mocked(bufferForReading).mockResolvedValue(null)
    expect(await readDraftTags("mine")).toEqual({ ok: false, message: "Sign in with Buffer first." })
    expect(asked).not.toHaveBeenCalled()
  })

  it("returns the post's tags and the organization's, editable only on a draft Queue Pilot wrote", async () => {
    fakeBuffer()
    expect(await readDraftTags("mine")).toEqual({ ok: true, canEdit: true, selected: [{ id: "t1", name: "Soups", color: "#8F2457" }], all: [{ id: "t1", name: "Soups", color: "#8F2457" }] })
    vi.mocked(wroteIds).mockResolvedValue(new Set())
    expect(await readDraftTags("mine")).toMatchObject({ ok: true, canEdit: false })
    signedIn([{ ...draft, status: "scheduled" }])
    vi.mocked(wroteIds).mockResolvedValue(new Set(["mine"]))
    expect(await readDraftTags("mine")).toMatchObject({ ok: true, canEdit: false })
  })
})

describe("setTagsOnDraft", () => {
  it("sets the organization's tags on a draft Queue Pilot wrote, sending the draft's own text", async () => {
    const edits = fakeBuffer()
    expect(await setTagsOnDraft("mine", ["t1", "t1"])).toEqual({ ok: true })
    expect(edits).toEqual([{ input: { id: "mine", text: "Soup night.", tagIds: ["t1"], saveToDraft: true } }])
  })

  it("refuses drafts it did not write, unknown tags and a rate limit, without editing", async () => {
    const edits = fakeBuffer()
    expect(await setTagsOnDraft("mine", ["not-ours"])).toMatchObject({ ok: false })
    vi.mocked(limit).mockResolvedValueOnce({ ok: false, resetSeconds: 30 } as never)
    expect(await setTagsOnDraft("mine", ["t1"])).toEqual({ ok: false, message: "Too many requests just now. Try again in 30 seconds." })
    vi.mocked(wroteIds).mockResolvedValue(new Set())
    expect(await setTagsOnDraft("mine", ["t1"])).toEqual({ ok: false, message: "Only drafts Queue Pilot wrote can be tagged here. Tag this one in Buffer." })
    expect(edits).toEqual([])
  })
})

describe("createTagForDraft", () => {
  it("creates a tag in the post's organization, trimmed", async () => {
    let sent: unknown
    fakeBuffer()
    const answer = buffer.answer
    buffer.answer = (q, v) => { if (q.includes("createTag")) sent = v; return answer(q, v) }
    expect(await createTagForDraft("mine", "  Weeknight ")).toEqual({ ok: true, tag: { id: "t2", name: "Weeknight", color: "#8F2457" } })
    expect(sent).toMatchObject({ input: { organizationId: "org", tag: { name: "Weeknight" } } })
  })

  it("refuses an empty name and a draft it did not write", async () => {
    fakeBuffer()
    expect(await createTagForDraft("mine", "   ")).toEqual({ ok: false, message: "Name the tag first." })
    vi.mocked(wroteIds).mockResolvedValue(new Set())
    expect(await createTagForDraft("mine", "Soups")).toMatchObject({ ok: false })
  })
})
