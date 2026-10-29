import { beforeEach, describe, expect, it, vi } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"

vi.mock("@/lib/current-user", () => ({ signedInUserId: vi.fn() }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/db", () => ({ db: () => { throw new Error("Unexpected database call") } }))
vi.mock("@/lib/voice-store", async (original) => ({ ...await original<typeof import("@/lib/voice-store")>(), postgresVoiceStore: () => store }))

const { memoryVoiceStore, MAX_EXAMPLES, MAX_PASTED_TEXT, MAX_NOTE } = await import("@/lib/voice-store")
const { signedInUserId } = await import("@/lib/current-user")
const { revalidatePath } = await import("next/cache")
const { addPastedVoiceExample, saveVoiceNote } = await import("./actions")
const { VoiceView } = await import("@/components/voice-view")
let store = memoryVoiceStore()

beforeEach(() => {
  store = memoryVoiceStore()
  vi.clearAllMocks()
  vi.mocked(signedInUserId).mockResolvedValue("person-a")
})

describe("pasted voice action", () => {
  it("requires sign-in", async () => {
    vi.mocked(signedInUserId).mockResolvedValue(null)
    expect(await addPastedVoiceExample("My post")).toEqual({ ok: false, message: "Sign in with Buffer first." })
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it("rejects oversized, blank and non-text input", async () => {
    for (const value of ["x".repeat(MAX_PASTED_TEXT + 1), " \u200b ", null, 42]) {
      expect((await addPastedVoiceExample(value as string)).ok).toBe(false)
    }
    expect((await store.get("person-a")).examples).toEqual([])
  })

  it("reports the example cap", async () => {
    for (let i = 0; i < MAX_EXAMPLES; i++) await addPastedVoiceExample(`Post ${i}`)
    expect(await addPastedVoiceExample("One more")).toEqual({ ok: false, message: expect.stringContaining("Remove one") })
    expect((await store.get("person-a")).examples).toHaveLength(MAX_EXAMPLES)
  })

  it("saves only for the signed-in person and refreshes Voice", async () => {
    expect(await addPastedVoiceExample("  My\u200b post\nSecond line  ")).toEqual({ ok: true })
    expect((await store.get("person-a")).examples).toEqual([{ postId: expect.stringMatching(/^pasted:/), channel: "Pasted", text: "My post\nSecond line" }])
    expect((await store.get("person-b")).examples).toEqual([])
    expect(revalidatePath).toHaveBeenCalledWith("/voice")
  })

  it("does not expose private storage errors", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {})
    vi.spyOn(store, "addExample").mockRejectedValue(new Error("person-a private failure"))
    expect(await addPastedVoiceExample("My post")).toEqual({ ok: false, message: "Could not save that just now. Try again in a minute." })
    log.mockRestore()
  })

  it("uses the connector note limit on the action too", async () => {
    expect((await saveVoiceNote("a".repeat(MAX_NOTE + 1))).ok).toBe(false)
    expect((await saveVoiceNote("a".repeat(MAX_NOTE))).ok).toBe(true)
  })

  it("offers pasting with no sent posts and keeps example mode read-only", () => {
    const live = renderToStaticMarkup(VoiceView({ mode: "live", note: null, examples: [], candidates: [] }))
    expect(live).toContain("Paste a post you wrote")
    expect(live).toContain('maxLength="2000"')
    const example = renderToStaticMarkup(VoiceView({ mode: "example" }))
    expect(example).not.toContain("textarea")
  })
})
