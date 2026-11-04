/**
 * @fileoverview The New material page's Buffer ideas board: sign-in required, Buffer's column order with unassigned
 * ideas first, one shared fetch for concurrent readers, and a failed read never kept.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/current-user", () => ({ bufferForReading: vi.fn() }))
vi.mock("@/db", () => ({ db: () => { throw new Error("Unexpected database call") } }))
const buffer = { answer: (() => ({})) as (query: string) => unknown, calls: 0 }
vi.mock("@/lib/buffer/client", async (original) => ({ ...await original<typeof import("@/lib/buffer/client")>(), bufferQuery: async (_t: string, q: string) => { buffer.calls++; const a = buffer.answer(q); if (a instanceof Error) throw a; return a } }))

const { bufferForReading } = await import("@/lib/current-user")
const { readIdeaBoards } = await import("./idea-actions")

const node = (id: string, groupId: string | null, title: string) => ({ node: { id, organizationId: "org", groupId, createdAt: 1_762_160_400, content: { title, text: null, services: [], date: null } } })
const board = () => (q: string) => q.includes("IdeaGroups")
  ? { ideaGroups: [{ id: "todo", name: "To Do", isLocked: false }, { id: "done", name: "Done", isLocked: false }] }
  : { ideas: { edges: [node("a", "done", "Old soup"), node("b", null, "Plan your content"), node("c", "todo", "Pantry swaps")], pageInfo: { hasNextPage: false, endCursor: null } } }
let person = 0

beforeEach(() => {
  // A new person each test, so one test's kept board never answers another.
  person += 1
  buffer.calls = 0
  vi.mocked(bufferForReading).mockResolvedValue({ userId: `person-${person}`, token: "tok", posts: [], channels: [{ id: "ch", organizationId: "org" }, { id: "ch2", organizationId: "org" }], teamSizes: {} } as never)
})

describe("readIdeaBoards", () => {
  it("requires sign-in", async () => {
    vi.mocked(bufferForReading).mockResolvedValue(null)
    expect(await readIdeaBoards()).toEqual({ ok: false, message: "Sign in with Buffer first." })
  })

  it("lays the board out as Buffer does: unassigned first, then the columns in Buffer's order, one board per organization", async () => {
    buffer.answer = board()
    expect(await readIdeaBoards()).toEqual({ ok: true, boards: [{ organizationId: "org", more: false, columns: [
      { id: "unassigned", name: "Unassigned", ideas: [{ id: "b", title: "Plan your content", text: null }] },
      { id: "todo", name: "To Do", ideas: [{ id: "c", title: "Pantry swaps", text: null }] },
      { id: "done", name: "Done", ideas: [{ id: "a", title: "Old soup", text: null }] },
    ] }] })
  })

  it("shares one Buffer read between concurrent visits and keeps it for the next one", async () => {
    buffer.answer = board()
    await Promise.all([readIdeaBoards(), readIdeaBoards(), readIdeaBoards()])
    await readIdeaBoards()
    expect(buffer.calls).toBe(2)
  })

  it("does not keep a failed read, so the next visit asks Buffer again", async () => {
    buffer.answer = () => new Error("Buffer is down")
    expect(await readIdeaBoards()).toEqual({ ok: false, message: "Buffer did not return your ideas. Try again in a minute." })
    buffer.answer = board()
    expect(await readIdeaBoards()).toMatchObject({ ok: true })
  })
})
