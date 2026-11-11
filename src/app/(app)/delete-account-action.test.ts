/**
 * @fileoverview Deleting the account also signs this browser out. The router only checks that a sign-in cookie
 * exists, so a cookie left behind after the account is gone kept the person "signed in" to an empty app that fell
 * back to sample data, instead of showing the homepage.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/current-user", () => ({ signedInUserId: vi.fn() }))
vi.mock("@/lib/rate-limit", () => ({ limit: vi.fn(async () => ({ ok: true })) }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/db", () => ({ db: () => { throw new Error("Unexpected database call") } }))
vi.mock("@/lib/delete-account", () => ({ deleteAccount: vi.fn(), LastAdminError: class LastAdminError extends Error { constructor() { super("You are this deployment's only admin.") } } }))
const jar = vi.hoisted(() => ({ getAll: vi.fn(), set: vi.fn() }))
vi.mock("next/headers", () => ({ cookies: async () => jar, headers: async () => new Headers() }))

const { signedInUserId } = await import("@/lib/current-user")
const { deleteAccount, LastAdminError } = await import("@/lib/delete-account")
const { deleteMyAccount } = await import("./actions")

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(signedInUserId).mockResolvedValue("person-a")
  jar.getAll.mockReturnValue([
    { name: "__Secure-better-auth.session_token", value: "t" },
    { name: "better-auth.session_data", value: "d" },
    { name: "theme", value: "dark" },
  ])
})

describe("deleteMyAccount", () => {
  it("clears this browser's sign-in cookies once the account is deleted, and leaves other cookies alone", async () => {
    vi.mocked(deleteAccount).mockResolvedValue(undefined as never)
    expect(await deleteMyAccount("delete")).toEqual({ ok: true })
    const cleared = jar.set.mock.calls.map(([name, value, opts]) => ({ name, value, maxAge: opts.maxAge, secure: opts.secure }))
    expect(cleared).toEqual([
      { name: "__Secure-better-auth.session_token", value: "", maxAge: 0, secure: true },
      { name: "better-auth.session_data", value: "", maxAge: 0, secure: false },
    ])
  })

  it("keeps the person signed in when the deletion fails, since nothing was removed", async () => {
    vi.mocked(deleteAccount).mockRejectedValue(new Error("db down"))
    expect((await deleteMyAccount("delete")).ok).toBe(false)
    expect(jar.set).not.toHaveBeenCalled()
  })

  it("tells the only admin why their account was not deleted, and keeps them signed in", async () => {
    const refusal = new LastAdminError()
    vi.mocked(deleteAccount).mockRejectedValue(refusal)
    expect(await deleteMyAccount("delete")).toEqual({ ok: false, message: refusal.message })
    expect(jar.set).not.toHaveBeenCalled()
  })
})
