/**
 * @fileoverview The composer's Templates and Hashtags lists: sign-in required, only slots on the person's own channels,
 * the slot's own organization, Buffer's partial lists continued by cursor (an entry on a later page is reachable), and
 * a clear message when the connection cannot read hashtags yet.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { BufferApiError } from "@/lib/buffer/client"

vi.mock("@/lib/current-user", () => ({ bufferForReading: vi.fn() }))
vi.mock("@/db", () => ({ db: () => { throw new Error("Unexpected database call") } }))
const buffer = { calls: [] as { q: string; v: Record<string, any> }[], answer: (() => ({})) as (q: string, v: Record<string, any>) => unknown }
vi.mock("@/lib/buffer/client", async (original) => ({ ...await original<typeof import("@/lib/buffer/client")>(), bufferQuery: async (_t: string, q: string, v: Record<string, any>) => { buffer.calls.push({ q, v }); const a = buffer.answer(q, v); if (a instanceof Error) throw a; return a } }))

const { bufferForReading } = await import("@/lib/current-user")
const { readComposerSnippets, readComposerTemplates } = await import("./library-actions")

const slot = "ch@2026-11-09T09:00:00.000Z"
const tpl = (id: string, visibility = "public") => ({ id, title: `T ${id}`, description: "d", emoji: "🚀", body: "Shipped {{feature}}.", visibility, organizationId: "org", updatedAt: "2026-11-01T00:00:00Z" })
const page = <T,>(key: string, nodes: T[], next: string | null) => ({ [key]: { edges: nodes.map((node) => ({ node })), pageInfo: { hasNextPage: next !== null, endCursor: next } } })

beforeEach(() => {
  vi.clearAllMocks()
  buffer.calls = []
  vi.mocked(bufferForReading).mockResolvedValue({ userId: "person-a", token: "tok", posts: [], channels: [{ id: "ch", organizationId: "org" }], teamSizes: {} } as never)
})

describe("composer templates", () => {
  it("requires sign-in and a slot on the person's own channel, before asking Buffer", async () => {
    vi.mocked(bufferForReading).mockResolvedValueOnce(null)
    expect(await readComposerTemplates(slot)).toEqual({ ok: false, message: "Sign in with Buffer first." })
    expect(await readComposerTemplates("someone-else@2026-11-09T09:00:00.000Z")).toMatchObject({ ok: false })
    expect(await readComposerTemplates("not a slot")).toMatchObject({ ok: false })
    expect(buffer.calls).toEqual([])
  })

  it("lists the organization's and the person's templates first, says when Buffer has more, and continues by cursor", async () => {
    // Four pages of one per read, then a fifth: the first read stops at its budget with a cursor.
    let n = 0
    buffer.answer = (q, v) => {
      expect(v.input.organizationId).toBe("org")
      n++
      return page("postTemplates", [tpl(`p${n}`, n === 2 ? "private" : "public")], n < 5 ? `c${n}` : null)
    }
    const first = await readComposerTemplates(slot)
    expect(first).toMatchObject({ ok: true, more: true, cursor: "c4" })
    if (!first.ok) return
    expect(first.templates[0]).toMatchObject({ id: "p2", mine: true })
    const rest = await readComposerTemplates(slot, first.cursor)
    expect(rest).toMatchObject({ ok: true, more: false, cursor: null, templates: [{ id: "p5" }] })
    expect(buffer.calls.at(-1)?.v.after).toBe("c4")
  })
})

describe("composer hashtags", () => {
  it("reaches a saved set on a later page by cursor", async () => {
    buffer.answer = (_q, v) => v.after === "s1" ? page("snippets", [{ id: "sn-2", name: "Launch", text: "#ship" }], null) : page("snippets", [{ id: "sn-1", name: "Soup", text: "#soup" }], "s1")
    // One page per read in this fake: the first read follows pages until its budget, so force a one-page read.
    const first = await readComposerSnippets(slot)
    expect(first).toMatchObject({ ok: true })
    if (!first.ok) return
    const all = first.more && first.cursor ? [...first.snippets, ...((await readComposerSnippets(slot, first.cursor)) as { snippets: unknown[] }).snippets] : first.snippets
    expect(all).toEqual(expect.arrayContaining([{ id: "sn-2", name: "Launch", text: "#ship" }]))
  })

  it("asks for a new sign-in when the connection cannot read hashtags yet, and refuses a bad cursor", async () => {
    buffer.answer = () => new BufferApiError("Forbidden", 200, "INSUFFICIENT_SCOPE")
    expect(await readComposerSnippets(slot)).toEqual({ ok: false, message: "To use your saved hashtags here, sign out and sign in with Buffer again to allow it." })
    expect(await readComposerSnippets(slot, "x".repeat(600))).toMatchObject({ ok: false })
  })
})
