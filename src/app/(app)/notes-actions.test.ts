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
const { readDraftNotes, addDraftNote, editDraftNote, deleteDraftNote, listNoteTeammates } = await import("./note-actions")
const post = { id: "mine", channelId: "ch", status: "draft", text: "Soup", dueAt: null, sentAt: null, externalLink: null, error: null }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(bufferForReading).mockResolvedValue({ userId: "person-a", token: "tok", posts: [post], channels: [{ id: "ch", organizationId: "org" }], teamSizes: { org: 1 } } as never)
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
    expect(await readDraftNotes("mine")).toEqual({ ok: true, more: false, team: false, notes: [
      { id: "n2", author: "Sara", avatar: null, createdAt: "2026-11-04T10:00:00Z", edited: false, text: "Use the new photo", mentions: [], canEdit: false, canDelete: false },
      { id: "n1", author: null, avatar: null, createdAt: "2026-11-03T10:00:00Z", edited: false, text: "Older", mentions: [], canEdit: false, canDelete: false },
    ] })
  })

  it("calls an organization with more than one person a team, and a solo one not", async () => {
    buffer.answer = () => ({ collaborationNotes: { edges: [], pageInfo: { hasNextPage: false, endCursor: null } } })
    expect(await readDraftNotes("mine")).toMatchObject({ ok: true, team: false })
    vi.mocked(bufferForReading).mockResolvedValue({ userId: "person-a", token: "tok", posts: [post], channels: [{ id: "ch", organizationId: "org" }], teamSizes: { org: 3 } } as never)
    expect(await readDraftNotes("mine")).toMatchObject({ ok: true, team: true })
    vi.mocked(bufferForReading).mockResolvedValue({ userId: "person-a", token: "tok", posts: [post], channels: [], teamSizes: {} } as never)
    expect(await readDraftNotes("mine")).toMatchObject({ ok: true, team: false })
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

describe("mentions survive an edit", () => {
  const sam = "urn:buffer:account:sam"
  const mentioned = { ...note("n1", ["updateNote"]), text: "@Sam check the chart", annotations: [{ type: "mention", text: "@Sam", indices: [0, 4], displayValue: "Sam", serviceEntityId: sam }] }
  const updates = (): Record<string, unknown>[] => []

  function answering(sent: Record<string, unknown>[]) {
    buffer.answer = (q, v) => {
      if (q.includes("collaborationNotes(")) return thread(mentioned as never)
      sent.push(v.input as Record<string, unknown>)
      return { updateCollaborationNote: { __typename: "UpdateCollaborationNoteSuccess" } }
    }
  }

  it("reads each note's mentions so the window can keep them", async () => {
    answering(updates())
    expect(await readDraftNotes("mine")).toMatchObject({ ok: true, notes: [{ id: "n1", mentions: [{ urn: sam, name: "Sam" }] }] })
  })

  it("keeps a mention whose @Name is still in the edited text, at its new offsets", async () => {
    const sent: Record<string, unknown>[] = []
    answering(sent)
    expect(await editDraftNote("mine", "n1", "Thanks, @Sam check the chart")).toEqual({ ok: true })
    expect(sent[0].annotations).toEqual([{ type: "mention", content: "@Sam", text: "@Sam", displayValue: "Sam", serviceEntityId: sam, indices: [8, 12] }])
  })

  it("drops a mention whose @Name the edit removed", async () => {
    const sent: Record<string, unknown>[] = []
    answering(sent)
    expect(await editDraftNote("mine", "n1", "Check the chart")).toEqual({ ok: true })
    expect(sent[0].annotations).toEqual([])
  })
})

describe("mentioning teammates from the draft window", () => {
  const sam = "urn:buffer:account:sam"
  const ana = "urn:buffer:account:ana"
  const members = { selectableTeamMembers: { edges: [
    { node: { id: "sam", urn: sam, name: "Sam Lee", email: "sam@x.com", avatar: "", isLocked: false } },
    { node: { id: "ana", urn: ana, name: null, email: "ana@x.com", avatar: "https://x/a.png", isLocked: true } },
  ], pageInfo: { hasNextPage: false, endCursor: null } } }
  const created = { createCollaborationNote: { __typename: "CreateCollaborationNoteSuccess", edge: { node: note("n9", ["updateNote"]) } } }

  it("lists the teammates who can read notes on the post's channel, locked ones marked", async () => {
    const asked: Record<string, unknown>[] = []
    buffer.answer = (_q, v) => { asked.push(v); return members }
    expect(await listNoteTeammates("mine", "a")).toEqual({ ok: true, more: false, teammates: [
      { urn: sam, name: "Sam Lee", email: "sam@x.com", avatar: null, locked: false },
      { urn: ana, name: "ana@x.com", email: "ana@x.com", avatar: "https://x/a.png", locked: true },
    ] })
    expect(asked[0]).toMatchObject({ input: { scope: { channelId: "ch" }, search: "a" } })
    expect(await listNoteTeammates("theirs")).toEqual({ ok: false, message: "This post is not in your queue." })
    expect(asked).toHaveLength(1)
  })

  it("adds a note with a picked teammate's mention at its place in the text", async () => {
    const sent: Record<string, unknown>[] = []
    buffer.answer = (q, v) => { if (q.includes("selectableTeamMembers")) return members; sent.push(v.input as Record<string, unknown>); return created }
    expect(await addDraftNote("mine", "Hi @Sam Lee, check", [sam])).toMatchObject({ ok: true })
    expect(sent[0].annotations).toEqual([{ type: "mention", content: "@Sam Lee", text: "@Sam Lee", displayValue: "Sam Lee", serviceEntityId: sam, indices: [3, 11] }])
  })

  it("drops a picked teammate whose @Name is no longer in the text, and refuses one who cannot read this channel's notes", async () => {
    const sent: Record<string, unknown>[] = []
    buffer.answer = (q, v) => { if (q.includes("selectableTeamMembers")) return members; sent.push(v.input as Record<string, unknown>); return created }
    expect(await addDraftNote("mine", "No names here", [sam])).toMatchObject({ ok: true })
    expect(sent[0].annotations).toEqual([])
    expect(await addDraftNote("mine", "Hi @Kim", ["urn:buffer:account:kim"])).toEqual({ ok: false, message: expect.stringContaining("can't see this post") })
    expect(sent).toHaveLength(1)
  })

  it("says plainly when Buffer refuses the whole note over a mentioned teammate", async () => {
    buffer.answer = (q) => q.includes("selectableTeamMembers") ? members : { createCollaborationNote: { __typename: "InvalidInputError", message: "Invalid mention" } }
    expect(await addDraftNote("mine", "Hi @Sam Lee", [sam])).toEqual({ ok: false, message: "Buffer did not save the note: a teammate you mentioned can't see this post. Remove that mention and send it again." })
  })

  it("an edit keeps saved mentions and adds newly picked ones", async () => {
    const sent: Record<string, unknown>[] = []
    const saved = { ...note("n1", ["updateNote"]), text: "@Sam Lee look", annotations: [{ type: "mention", text: "@Sam Lee", indices: [0, 8], displayValue: "Sam Lee", serviceEntityId: sam }] }
    buffer.answer = (q, v) => {
      if (q.includes("collaborationNotes(")) return thread(saved as never)
      if (q.includes("selectableTeamMembers")) return members
      sent.push(v.input as Record<string, unknown>)
      return { updateCollaborationNote: { __typename: "UpdateCollaborationNoteSuccess" } }
    }
    expect(await editDraftNote("mine", "n1", "@Sam Lee look, @ana@x.com too", [sam, ana])).toEqual({ ok: true })
    expect((sent[0].annotations as { serviceEntityId: string; indices: number[] }[]).map((a) => [a.serviceEntityId, a.indices])).toEqual([[sam, [0, 8]], [ana, [15, 25]]])
  })
})
