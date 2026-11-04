/**
 * @fileoverview The draft window's team notes: sign-in required, only posts in the person's own queue, and a missing
 * Notes permission says to sign in again instead of failing quietly.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { BufferApiError } from "@/lib/buffer/client"

vi.mock("@/lib/current-user", () => ({ bufferForReading: vi.fn(), signedInUserId: vi.fn() }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/db", () => ({ db: () => { throw new Error("Unexpected database call") } }))
vi.mock("@/lib/rate-limit", () => ({ limit: vi.fn(async () => ({ ok: true })) }))
const buffer = { answer: (() => ({})) as (query: string, variables: Record<string, unknown>) => unknown }
vi.mock("@/lib/buffer/client", async (original) => ({ ...await original<typeof import("@/lib/buffer/client")>(), bufferQuery: async (_t: string, q: string, v: Record<string, unknown>) => { const a = buffer.answer(q, v); if (a instanceof Error) throw a; return a } }))

const { bufferForReading } = await import("@/lib/current-user")
const { readDraftNotes, addDraftNote, editDraftNote, deleteDraftNote } = await import("./note-actions")
const post = { id: "mine", channelId: "ch", status: "draft", text: "Soup", dueAt: null, sentAt: null, externalLink: null, error: null }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(bufferForReading).mockResolvedValue({ userId: "person-a", token: "tok", posts: [post] } as never)
})

describe("readDraftNotes", () => {
  it("requires sign-in", async () => {
    vi.mocked(bufferForReading).mockResolvedValue(null)
    expect(await readDraftNotes("mine")).toEqual({ ok: false, message: "Sign in with Buffer first." })
  })

  it("never asks Buffer about a post outside the person's queue", async () => {
    const asked = vi.fn()
    buffer.answer = (q) => { asked(q); return {} }
    expect(await readDraftNotes("someone-elses")).toEqual({ ok: false, message: "This post is not in your queue." })
    expect(asked).not.toHaveBeenCalled()
  })

  it("returns the notes newest first with authors, a deleted author as null", async () => {
    buffer.answer = (_q, v) => {
      expect(v).toMatchObject({ input: { subject: { postId: "mine" } } })
      return { collaborationNotes: { edges: [
        { node: { id: "n2", text: "Use the new photo", authorId: "a", author: { id: "a", name: "Sara" }, allowedActions: [], createdAt: "2026-11-04T10:00:00Z", updatedAt: "2026-11-04T10:00:00Z" } },
        { node: { id: "n1", text: "Older", authorId: "b", author: null, allowedActions: [], createdAt: "2026-11-03T10:00:00Z", updatedAt: "2026-11-03T10:00:00Z" } },
      ], pageInfo: { hasNextPage: false, endCursor: null } } }
    }
    expect(await readDraftNotes("mine")).toEqual({ ok: true, more: false, notes: [
      { id: "n2", author: "Sara", createdAt: "2026-11-04T10:00:00Z", text: "Use the new photo", canEdit: false, canDelete: false },
      { id: "n1", author: null, createdAt: "2026-11-03T10:00:00Z", text: "Older", canEdit: false, canDelete: false },
    ] })
  })

  it("tells the person to sign in again when the Notes permission is missing, and reports other failures plainly", async () => {
    buffer.answer = () => new BufferApiError("Forbidden", 200, "INSUFFICIENT_SCOPE")
    expect(await readDraftNotes("mine")).toEqual({ ok: false, message: expect.stringContaining("sign in with Buffer again") })
    buffer.answer = () => new BufferApiError("Buffer API returned 500", 500)
    vi.spyOn(console, "error").mockImplementation(() => {})
    expect(await readDraftNotes("mine")).toEqual({ ok: false, message: "Buffer did not answer. Try again in a minute." })
  })
})

const note = (id: string, actions: string[]) => ({ id, text: `note ${id}`, authorId: "me", author: { id: "me", name: "Me" }, allowedActions: actions, createdAt: "2026-11-04T10:00:00Z", updatedAt: "2026-11-04T10:00:00Z" })
const thread = (...nodes: ReturnType<typeof note>[]) => ({ collaborationNotes: { edges: nodes.map((node) => ({ node })), pageInfo: { hasNextPage: false, endCursor: null } } })

describe("adding, editing and deleting notes from the draft window", () => {
  it("adds a note to a post in the queue, trimmed, and never to a post outside it", async () => {
    const sent: Record<string, unknown>[] = []
    buffer.answer = (_q, v) => { sent.push(v); return { createCollaborationNote: { __typename: "CreateCollaborationNoteSuccess", edge: { node: note("n9", ["updateNote", "deleteNote"]) } } } }
    expect(await addDraftNote("mine", "  Price checked.  ")).toMatchObject({ ok: true, note: { id: "n9", canEdit: true, canDelete: true } })
    expect(sent[0]).toEqual({ input: { subject: { postId: "mine" }, text: "Price checked.", annotations: [] } })
    expect(await addDraftNote("theirs", "x")).toEqual({ ok: false, message: "This post is not in your queue." })
    expect((await addDraftNote("mine", "   ")).ok).toBe(false)
    expect(sent).toHaveLength(1)
  })

  it("says a dropped add may have saved, so the person does not add it twice", async () => {
    buffer.answer = () => new TypeError("fetch failed")
    vi.spyOn(console, "error").mockImplementation(() => {})
    expect(await addDraftNote("mine", "x")).toEqual({ ok: false, message: expect.stringContaining("may be saved") })
  })

  it("edits or deletes only a note on this post that Buffer lets the person change", async () => {
    const mutations: string[] = []
    buffer.answer = (q, v) => {
      if (q.includes("collaborationNotes(")) return thread(note("mine-note", ["updateNote", "deleteNote"]), note("sara-note", []))
      mutations.push(`${q.includes("updateCollaborationNote") ? "update" : "delete"}:${(v.input as { noteId: string }).noteId}`)
      return q.includes("updateCollaborationNote") ? { updateCollaborationNote: { __typename: "UpdateCollaborationNoteSuccess" } } : { deleteCollaborationNote: { __typename: "DeleteCollaborationNoteSuccess", noteId: "mine-note" } }
    }
    expect(await editDraftNote("mine", "sara-note", "changed")).toEqual({ ok: false, message: "Buffer does not let you change this note." })
    expect(await deleteDraftNote("mine", "elsewhere")).toEqual({ ok: false, message: "That note is no longer on this post." })
    expect(await editDraftNote("mine", "mine-note", "changed")).toEqual({ ok: true })
    expect(await deleteDraftNote("mine", "mine-note")).toEqual({ ok: true })
    expect(await deleteDraftNote("theirs", "mine-note")).toEqual({ ok: false, message: "This post is not in your queue." })
    expect(mutations).toEqual(["update:mine-note", "delete:mine-note"])
  })
})
