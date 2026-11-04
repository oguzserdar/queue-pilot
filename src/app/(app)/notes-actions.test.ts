/**
 * @fileoverview The draft window's team notes: sign-in required, only posts in the person's own queue, and a missing
 * Notes permission says to sign in again instead of failing quietly.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { BufferApiError } from "@/lib/buffer/client"

vi.mock("@/lib/current-user", () => ({ bufferForReading: vi.fn(), signedInUserId: vi.fn() }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/db", () => ({ db: () => { throw new Error("Unexpected database call") } }))
const buffer = { answer: (() => ({})) as (query: string, variables: Record<string, unknown>) => unknown }
vi.mock("@/lib/buffer/client", async (original) => ({ ...await original<typeof import("@/lib/buffer/client")>(), bufferQuery: async (_t: string, q: string, v: Record<string, unknown>) => { const a = buffer.answer(q, v); if (a instanceof Error) throw a; return a } }))

const { bufferForReading } = await import("@/lib/current-user")
const { readDraftNotes } = await import("./actions")
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
      { id: "n2", author: "Sara", createdAt: "2026-11-04T10:00:00Z", text: "Use the new photo" },
      { id: "n1", author: null, createdAt: "2026-11-03T10:00:00Z", text: "Older" },
    ] })
  })

  it("tells the person to sign in again when the Notes permission is missing, and reports other failures plainly", async () => {
    buffer.answer = () => new BufferApiError("Forbidden", 200, "INSUFFICIENT_SCOPE")
    expect(await readDraftNotes("mine")).toEqual({ ok: false, message: expect.stringContaining("sign in with Buffer again") })
    buffer.answer = () => new BufferApiError("Buffer API returned 500", 500)
    vi.spyOn(console, "error").mockImplementation(() => {})
    expect(await readDraftNotes("mine")).toEqual({ ok: false, message: "Buffer did not return the notes. Try again in a minute." })
  })
})
