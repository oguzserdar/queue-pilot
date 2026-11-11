/**
 * @fileoverview Better Auth gives a new account its starting rule when the user is created, and only then: a returning
 * sign-in (a new session for the same user) does not seed it again.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const seeded = vi.hoisted(() => vi.fn(async (_userId: string) => {}));
vi.mock("./starting-rule", () => ({ seedStartingRuleSafely: seeded }));
vi.mock("./security-events", () => ({ recordSecurityEvent: async () => {} }));
vi.mock("../db", () => ({ db: () => ({}), schema: {} }));
vi.mock("better-auth/adapters/drizzle", async () => {
  const { memoryAdapter } = await import("better-auth/adapters/memory");
  const tables: Record<string, unknown[]> = Object.fromEntries(["user", "session", "account", "verification", "jwks", "rateLimit", "oauthClient", "oauthResource", "oauthClientResource", "oauthRefreshToken", "oauthAccessToken", "oauthConsent", "oauthClientAssertion"].map((name) => [name, []]));
  return { drizzleAdapter: () => memoryAdapter(tables) };
});
const { buildAuth } = await import("./auth");
const auth = buildAuth({ clientId: "test", secret: "starting-rule-test-".padEnd(40, "x"), baseURL: "https://qp.example" });

beforeEach(() => { seeded.mockClear(); });

describe("starting rule on account creation", () => {
  it("seeds the new user once, and not again on a later sign-in", async () => {
    const ctx = await auth.$context;
    // The path a first Buffer sign-in takes: the user and the Buffer account in one transaction.
    const { user } = await ctx.internalAdapter.createOAuthUser({ email: "new@example.com", name: "New", emailVerified: true }, { providerId: "buffer", accountId: "buffer-1" });
    expect(seeded).toHaveBeenCalledTimes(1);
    expect(seeded).toHaveBeenCalledWith(user.id);
    await ctx.internalAdapter.createSession(user.id, false);
    await ctx.internalAdapter.createSession(user.id, false);
    expect(seeded).toHaveBeenCalledTimes(1);
  });
});
