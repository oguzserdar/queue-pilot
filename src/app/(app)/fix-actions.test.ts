/**
 * @fileoverview The Playbook's same-fix offer actions: sign-in first, the saved copy of the account and never a Buffer
 * read when the Playbook opens, each confirmed repeat shown with its edit, place and rule, and Keep or Not now saved through the signed
 * suggestion, refreshing the Playbook and Home.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))
vi.mock("@/db", () => ({ db: () => { throw new Error("Unexpected database call") } }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/lib/current-user", () => ({ signedInUserId: vi.fn(), bufferForWriting: vi.fn() }))
vi.mock("@/lib/rate-limit", () => ({ limit: vi.fn() }))
vi.mock("@/lib/judge-model", () => ({ AiCapError: class AiCapError extends Error {} }))
vi.mock("@/lib/rule-suggestions", () => ({ ruleSuggestions: vi.fn(), applySuggestion: vi.fn() }))
const snapshotGet = vi.fn()
vi.mock("@/lib/buffer/snapshot-store", () => ({ postgresSnapshotStore: () => ({ get: snapshotGet }) }))

const { signedInUserId, bufferForWriting } = await import("@/lib/current-user")
const { limit } = await import("@/lib/rate-limit")
const { AiCapError } = await import("@/lib/judge-model")
const { ruleSuggestions, applySuggestion } = await import("@/lib/rule-suggestions")
const { revalidatePath } = await import("next/cache")
const { checkRepeatedFixes, keepRepeatedFix, setRepeatedFixAside } = await import("./fix-actions")

const buffer = { userId: "person-a", token: "tok", channels: [{ id: "ch-li", name: "Alex Rivera", service: "linkedin" }], posts: [], timeZone: "UTC", range: { start: new Date(), end: new Date() } }
const ending = "Full issue: thisweekin.ai/41"
const suggestion = {
  key: "linkedin|account:ch-li|ends_with|full issue: thisweekin.ai/41",
  token: "signed-token",
  fixes: 2,
  rule: { kind: "ends_with", phrase: ending, channels: ["linkedin"], accountIds: ["ch-li"], level: "warn", text: `End with "${ending}"` },
  evidence: {
    fix: { kind: "ends_with", phrase: ending }, channelId: "ch-li", network: "linkedin", count: 2,
    examples: [{ before: "Gemini 4 Carbon ranks first on the index, at 59.", after: `Gemini 4 Carbon ranks first on the index, at 59. ${ending}` }, { before: "Kimi K3.1 Pro is out.", after: `Kimi K3.1 Pro is out. ${ending}` }],
    why: "Both posts point readers to the full issue the same way.",
  },
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(signedInUserId).mockResolvedValue("person-a")
  vi.mocked(limit).mockResolvedValue({ ok: true } as never)
  vi.mocked(bufferForWriting).mockResolvedValue(buffer as never)
  snapshotGet.mockResolvedValue({ data: { channels: buffer.channels, posts: [] } })
  vi.mocked(ruleSuggestions).mockResolvedValue({ suggestions: [suggestion], note: "" } as never)
  vi.mocked(applySuggestion).mockResolvedValue({ ok: true, id: "r9", message: "Suggestion kept as a playbook rule." })
})

describe("checkRepeatedFixes", () => {
  it("requires sign-in and asks nothing", async () => {
    vi.mocked(signedInUserId).mockResolvedValue(null)
    expect(await checkRepeatedFixes()).toEqual({ ok: false, message: "Sign in with Buffer first." })
    expect(bufferForWriting).not.toHaveBeenCalled()
    expect(ruleSuggestions).not.toHaveBeenCalled()
  })

  it("never reads Buffer when the Playbook opens, so the shared allowance stays for saving and Approve", async () => {
    await checkRepeatedFixes()
    expect(ruleSuggestions).toHaveBeenCalledWith("person-a", "fixes", expect.any(Function))
    expect(bufferForWriting).not.toHaveBeenCalled()
    expect(limit).not.toHaveBeenCalled()
  })

  it("still answers when the saved copy cannot be read, naming the network without the account", async () => {
    snapshotGet.mockRejectedValue(new Error("db down"))
    const r = await checkRepeatedFixes()
    expect(r.ok && r.offers[0].where).toBe(`On LinkedIn you added "${ending}" at the end of 2 drafts.`)
  })

  it("shows each confirmed repeat with the edit, the account and network, the rule and the model's reason", async () => {
    const r = await checkRepeatedFixes()
    expect(r).toEqual({ ok: true, note: "", offers: [{
      token: "signed-token",
      rule: `End with "${ending}"`,
      drafts: 2,
      before: "…on the index, at 59.",
      after: `…on the index, at 59. ${ending}`,
      change: { lead: "…on the index, at 59.", removed: "", added: ending, tail: "" },
      where: `On Alex Rivera (LinkedIn) you added "${ending}" at the end of 2 drafts.`,
      why: "Both posts point readers to the full issue the same way.",
    }] })
  })

  it("offers no card when the model calls none a lasting preference, and passes on its plain line", async () => {
    vi.mocked(ruleSuggestions).mockResolvedValue({ suggestions: [], note: "Found 1 repeated fix, but none looked like a lasting preference. One-off facts and chance matches are not offered." } as never)
    expect(await checkRepeatedFixes()).toEqual({ ok: true, offers: [], note: "Found 1 repeated fix, but none looked like a lasting preference. One-off facts and chance matches are not offered." })
  })

  it("passes on the AI allowance message when it is used up", async () => {
    vi.mocked(ruleSuggestions).mockRejectedValue(new AiCapError("Today's AI actions are used up. They come back tomorrow."))
    expect(await checkRepeatedFixes()).toEqual({ ok: false, message: "Today's AI actions are used up. They come back tomorrow." })
  })

  it("turns any other AI failure into a plain retry line without the raw error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    vi.mocked(ruleSuggestions).mockRejectedValue(new Error("socket hang up sk-secret"))
    const r = await checkRepeatedFixes()
    expect(r).toEqual({ ok: false, message: "The AI could not read your edits just now. Try again in a minute." })
  })
})

describe("keepRepeatedFix and setRepeatedFixAside", () => {
  it("require sign-in and save nothing", async () => {
    vi.mocked(signedInUserId).mockResolvedValue(null)
    expect(await keepRepeatedFix("signed-token")).toEqual({ ok: false, message: "Sign in with Buffer first." })
    expect(await setRepeatedFixAside("signed-token")).toEqual({ ok: false, message: "Sign in with Buffer first." })
    expect(applySuggestion).not.toHaveBeenCalled()
  })

  it("keeps the signed suggestion as a rule and refreshes the Playbook and Home", async () => {
    expect(await keepRepeatedFix("signed-token")).toEqual({ ok: true, message: "Suggestion kept as a playbook rule." })
    expect(applySuggestion).toHaveBeenCalledWith("person-a", "signed-token", "keep")
    expect(revalidatePath).toHaveBeenCalledWith("/playbook")
    expect(revalidatePath).toHaveBeenCalledWith("/")
  })

  it("sets the repeat aside with Not now so it is not offered again", async () => {
    vi.mocked(applySuggestion).mockResolvedValue({ ok: true, message: "Suggestion dismissed." })
    expect(await setRepeatedFixAside("signed-token")).toEqual({ ok: true, message: "Suggestion dismissed." })
    expect(applySuggestion).toHaveBeenCalledWith("person-a", "signed-token", "dismiss")
  })

  it("refreshes nothing when the suggestion was refused, and words it for this page", async () => {
    vi.mocked(applySuggestion).mockResolvedValue({ ok: false, message: "That suggestion is invalid or expired. List suggestions again." })
    expect(await keepRepeatedFix("old-token")).toEqual({ ok: false, message: "That suggestion is invalid or expired. Open the playbook again." })
    expect(revalidatePath).not.toHaveBeenCalled()
  })
})
