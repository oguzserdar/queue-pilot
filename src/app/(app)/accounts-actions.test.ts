/**
 * @fileoverview The several-accounts composer's save: it refuses bad input before Buffer is asked, keeps to one
 * organization, finds the same post again on a retry (bringing edited text up to date instead of making a second
 * one), maps each refused account back to its tab, and says nothing was scheduled.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/current-user", () => ({ bufferForReading: vi.fn() }))
vi.mock("@/db", () => ({ db: () => { throw new Error("Unexpected database call") } }))
vi.mock("@/lib/rate-limit", () => ({ limit: vi.fn(async () => ({ ok: true })) }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/lib/buffer/workspace", () => ({ textLimits: vi.fn(async () => new Map([["x", 25000]])) }))
const flow = vi.hoisted(() => ({ save: vi.fn(), promote: vi.fn() }))
vi.mock("@/lib/content-item-flow", () => ({ contentItemFlow: () => flow }))

const { bufferForReading } = await import("@/lib/current-user")
const { readComposerAccounts, saveForAccounts } = await import("./accounts-actions")

const id = "8f0c1d2e-3a4b-4c5d-8e6f-7a8b9c0d1e2f"
const channels = [
  { id: "x", name: "My X", service: "twitter", organizationId: "org", isDisconnected: false },
  { id: "li", name: "My LinkedIn", service: "linkedin", organizationId: "org", isDisconnected: false },
  { id: "other", name: "Client page", service: "facebook", organizationId: "org-2", isDisconnected: false },
]
const draftItem = (text: string) => ({ id: "ci-1", organizationId: "org", title: null, targetDate: null, createdAt: "", allowedActions: [], tags: [], body: { kind: "draft", text, aiAssisted: true, mediaCount: 0 } })

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(bufferForReading).mockResolvedValue({ userId: "person-a", token: "tok", posts: [], channels, teamSizes: {} } as never)
  flow.save.mockImplementation(async (_b: unknown, input: { text: string }) => ({ text: "Draft saved", isError: false, item: draftItem(input.text) }))
  flow.promote.mockResolvedValue({ text: "Buffer has 2 drafts", isError: false, created: 2, recorded: 2 })
})

describe("readComposerAccounts", () => {
  it("gives each account its Buffer limit when Buffer states one, else the built-in table", async () => {
    const r = await readComposerAccounts()
    expect(r.ok && r.accounts.find((a) => a.id === "x")).toMatchObject({ limit: 25000, limitFrom: "buffer" })
    expect(r.ok && r.accounts.find((a) => a.id === "li")).toMatchObject({ limit: 3000, limitFrom: "built-in" })
  })
})

describe("saveForAccounts", () => {
  const ok = { requestId: id, text: "Soup night.", versions: [{ channelId: "x", text: "Soup night." }, { channelId: "li", text: "Soup night, longer." }] }

  it("refuses bad input and unfilled placeholders before asking Buffer", async () => {
    expect(await saveForAccounts({ ...ok, requestId: "nope" })).toMatchObject({ ok: false })
    expect(await saveForAccounts({ ...ok, text: " " })).toMatchObject({ ok: false, message: "Write the post first." })
    expect(await saveForAccounts({ ...ok, versions: [] })).toMatchObject({ ok: false })
    expect(await saveForAccounts({ ...ok, versions: [{ channelId: "x", text: "Shipped {{feature}}." }] })).toEqual({ ok: false, message: "Fill in {{feature}} before saving." })
    expect(flow.save).not.toHaveBeenCalled()
  })

  it("keeps to one organization", async () => {
    expect(await saveForAccounts({ ...ok, versions: [{ channelId: "x", text: "a" }, { channelId: "other", text: "b" }] })).toEqual({ ok: false, message: "Choose accounts from one Buffer organization." })
    expect(flow.save).not.toHaveBeenCalled()
  })

  it("saves the main text with the composer's request id, then one draft per account, and says nothing was scheduled", async () => {
    expect(await saveForAccounts(ok)).toEqual({ ok: true, saved: 2, message: "Saved 2 drafts in Buffer. Nothing was scheduled." })
    expect(flow.save).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ requestId: id, text: "Soup night.", organizationId: "org" }))
    expect(flow.promote).toHaveBeenCalledWith(expect.anything(), { contentItemId: "ci-1", expectedDraftText: "Soup night.", versions: ok.versions })
  })

  it("brings this composer's earlier text up to date on a retry instead of making a second post", async () => {
    flow.save.mockResolvedValueOnce({ text: "found", isError: false, item: draftItem("Soup nite.") })
    await saveForAccounts({ ...ok, previousText: "Soup nite." })
    expect(flow.save).toHaveBeenNthCalledWith(2, expect.anything(), { contentItemId: "ci-1", text: "Soup night.", expectedText: "Soup nite." })
    expect(flow.promote).toHaveBeenCalledTimes(1)
  })

  it("keeps an edit made in Buffer after a refused first save, instead of overwriting it", async () => {
    // First save was refused by a rule; then the person changed the post in Buffer.
    flow.save.mockResolvedValueOnce({ text: "found", isError: false, item: draftItem("Edited in Buffer.") })
    const r = await saveForAccounts({ ...ok, previousText: "Soup nite." })
    expect(r).toMatchObject({ ok: false, message: expect.stringContaining("changed in Buffer after your last save") })
    expect(flow.save).toHaveBeenCalledTimes(1)
    expect(flow.promote).not.toHaveBeenCalled()
    // Without a record of what was sent, a different text in Buffer is not taken as a baseline either.
    flow.save.mockResolvedValueOnce({ text: "found", isError: false, item: draftItem("Edited in Buffer.") })
    expect(await saveForAccounts(ok)).toMatchObject({ ok: false })
    expect(flow.promote).not.toHaveBeenCalled()
  })

  it("returns each refusal with its account id, so two accounts with the same name never swap", async () => {
    vi.mocked(bufferForReading).mockResolvedValue({ userId: "person-a", token: "tok", posts: [], teamSizes: {}, channels: [
      { id: "x", name: "Mark", service: "twitter", organizationId: "org", isDisconnected: false },
      { id: "x2", name: "Mark", service: "twitter", organizationId: "org", isDisconnected: false },
    ] } as never)
    flow.promote.mockResolvedValueOnce({ text: "{}", isError: false, refused: [{ channelId: "x2", reason: "Say stock (it says broth)" }] })
    expect(await saveForAccounts({ ...ok, versions: [{ channelId: "x", text: "Soup." }, { channelId: "x2", text: "Broth." }] })).toEqual({ ok: false, message: "Nothing was saved yet. Fix these accounts:", refused: [{ channelId: "x2", reason: "Say stock (it says broth)" }] })
  })

  it("asks to press Save again when Buffer's answer is unclear", async () => {
    flow.promote.mockRejectedValueOnce(new TypeError("fetch failed"))
    expect(await saveForAccounts(ok)).toMatchObject({ ok: false, message: expect.stringContaining("never saved twice") })
  })
})
