import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Post } from "@/lib/buffer/queries"

vi.mock("@/lib/current-user", () => ({ signedInUserId: vi.fn(), freshBufferForCurrentUser: vi.fn() }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/lib/rate-limit", () => ({ limit: vi.fn(async () => ({ ok: true })) }))
vi.mock("@/lib/written-store", () => ({ wroteIds: vi.fn() }))
vi.mock("@/lib/buffer/client", async (original) => ({ ...await original<typeof import("@/lib/buffer/client")>(), bufferQuery: vi.fn() }))
vi.mock("@/db", () => ({ db: () => { throw new Error("Unexpected database call") } }))

const { freshBufferForCurrentUser, signedInUserId } = await import("@/lib/current-user")
const { wroteIds } = await import("@/lib/written-store")
const { bufferQuery } = await import("@/lib/buffer/client")
const { approveDrafts } = await import("./actions")
const markScheduled = vi.fn()
const post = (id: string): Post => ({ id, channelId: "ch", status: "draft", via: "api", text: "Draft", dueAt: "2099-11-01T09:00:00Z", sentAt: null, externalLink: null, error: null })

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(signedInUserId).mockResolvedValue("person-a")
  vi.mocked(freshBufferForCurrentUser).mockResolvedValue({ userId: "person-a", token: "token-a", posts: [post("ours"), post("foreign")], markScheduled })
  vi.mocked(wroteIds).mockResolvedValue(new Set(["ours"]))
  vi.mocked(bufferQuery).mockResolvedValue({ editPost: { __typename: "PostActionSuccess" } })
})

describe("Approve action", () => {
  it("uses the authenticated person's writing records and marks only their successful approvals", async () => {
    const result = await approveDrafts(["ours", "foreign"])
    expect(wroteIds).toHaveBeenCalledWith("person-a", "ours", "foreign")
    expect(result).toEqual({ ok: true, approved: ["ours"], refused: [{ id: "foreign", reason: "Queue Pilot did not write this draft. Schedule it in Buffer." }] })
    expect(bufferQuery).toHaveBeenCalledTimes(1)
    expect(bufferQuery).toHaveBeenCalledWith("token-a", expect.any(String), { input: { id: "ours", saveToDraft: false, mode: "customScheduled", dueAt: "2099-11-01T09:00:00Z" } })
    expect(markScheduled).toHaveBeenCalledWith(["ours"])
  })

  it("refuses signed-out requests without an ownership lookup or write", async () => {
    vi.mocked(signedInUserId).mockResolvedValue(null)
    vi.mocked(freshBufferForCurrentUser).mockResolvedValue(null)
    expect(await approveDrafts(["ours"])).toEqual({ ok: false, kind: "signedOut" })
    expect(wroteIds).not.toHaveBeenCalled()
    expect(bufferQuery).not.toHaveBeenCalled()
  })

  it("makes no write when ownership cannot be read", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {})
    vi.mocked(wroteIds).mockRejectedValue(new Error("Storage unavailable"))
    expect(await approveDrafts(["ours"])).toEqual({ ok: false, kind: "failed" })
    expect(bufferQuery).not.toHaveBeenCalled()
    expect(markScheduled).not.toHaveBeenCalled()
    log.mockRestore()
  })
})
