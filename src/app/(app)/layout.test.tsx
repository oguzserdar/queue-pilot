/**
 * @fileoverview The app layout sends a visitor whose sign-in cookie has no session behind it to /auth/expired, which
 * clears it, instead of showing an empty app where the homepage belongs. A visitor with no cookie, or with a live
 * session, is never redirected.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({ cookie: "", userId: null as string | null, authOn: true }))
vi.mock("next/headers", () => ({ headers: async () => new Headers(state.cookie ? { cookie: state.cookie } : {}) }))
vi.mock("next/navigation", () => ({ redirect: vi.fn((to: string) => { throw new Error(`redirect:${to}`) }) }))
vi.mock("@/components/app-shell", () => ({ AppShell: () => null }))
vi.mock("@/components/buffer-unreadable", () => ({ BufferUnreadable: () => null }))
vi.mock("@/lib/current-user", () => ({
  getCurrentUser: async () => ({ user: null, signInOpen: false, unreadable: null }),
  signedInProfile: async () => null,
  signedInUserId: async () => state.userId,
}))

vi.mock("@/lib/auth", () => ({ getAuth: async () => (state.authOn ? {} : null) }))

const { default: AppLayout } = await import("./layout")

beforeEach(() => { vi.stubEnv("LANDING_PAGE", "on"); state.cookie = ""; state.userId = null; state.authOn = true })

describe("AppLayout", () => {
  it("clears a sign-in cookie that has no session behind it", async () => {
    state.cookie = "__Secure-better-auth.session_token=dead"
    await expect(AppLayout({ children: null })).rejects.toThrow("redirect:/auth/expired")
  })

  it("never redirects when sign-in is not set up, so the expired page cannot send the visitor back in a loop", async () => {
    state.cookie = "__Secure-better-auth.session_token=dead"
    state.authOn = false
    await expect(AppLayout({ children: null })).resolves.toBeTruthy()
  })

  it("shows the page for a visitor with no sign-in cookie", async () => {
    await expect(AppLayout({ children: null })).resolves.toBeTruthy()
  })

  it("never redirects while the session is live", async () => {
    state.cookie = "__Secure-better-auth.session_token=live"
    state.userId = "person-a"
    await expect(AppLayout({ children: null })).resolves.toBeTruthy()
  })
})
