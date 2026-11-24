import { describe, expect, it, vi } from "vitest";

// These run against the real Better Auth instance Queue Pilot builds (src/lib/auth.ts), with its jwt plugin and its
// key table, so a passing test means the production signer accepts exactly what these functions mint. Only the
// database underneath is swapped for Better Auth's in-memory adapter.
vi.mock("../../db", () => ({ db: () => ({}), schema: {} }));
vi.mock("better-auth/adapters/drizzle", async () => {
  const { memoryAdapter } = await import("better-auth/adapters/memory");
  // Each auth instance gets its own empty tables, so a second instance is a second server with its own keys.
  const fresh = () => new Proxy({} as Record<string, unknown[]>, { get: (t, model: string) => (t[model] ??= []) });
  return { drizzleAdapter: () => memoryAdapter(fresh()) };
});

const { buildAuth } = await import("../auth");
const tokens = await import("./tokens");
const {
  ACCESS_TOKEN_TTL_SECONDS,
  ASSERTION_TTL_SECONDS,
  issueAccessToken,
  issueIdentityAssertion,
  verifyAccessToken,
  verifyIdentityAssertion,
} = tokens;

const baseURL = "http://localhost:3000";
const auth = buildAuth({ clientId: "test", secret: "test-secret-".padEnd(40, "x"), baseURL });
const registrationId = "reg_test123";

function claimsOf(token: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
}

describe("the identity assertion", () => {
  it("round-trips through the plugin's own signer and verifier", async () => {
    const issued = await issueIdentityAssertion(auth, { baseURL, registrationId });
    const v = await verifyIdentityAssertion(auth, { baseURL, token: issued.token });
    expect(v).toEqual({ ok: true, registrationId, jti: issued.jti, expiresAt: issued.expiresAt });
  });

  it("lasts 365 days and names the registration, a fresh jti and its purpose", async () => {
    const now = new Date("2026-11-14T10:00:00Z");
    const a = await issueIdentityAssertion(auth, { baseURL, registrationId, now });
    const b = await issueIdentityAssertion(auth, { baseURL, registrationId, now });
    const c = claimsOf(a.token);
    expect(c.sub).toBe(registrationId);
    expect(c.purpose).toBe("identity_assertion");
    expect((c.exp as number) - (c.iat as number)).toBe(ASSERTION_TTL_SECONDS);
    expect(ASSERTION_TTL_SECONDS).toBe(365 * 24 * 60 * 60);
    expect(a.expiresAt.toISOString()).toBe("2027-11-14T10:00:00.000Z");
    expect(a.jti).not.toBe(b.jti);
  });
});

describe("the access token", () => {
  it("round-trips, lasts one hour, and has no refresh token", async () => {
    const issued = await issueAccessToken(auth, { baseURL, registrationId });
    expect(issued.expiresIn).toBe(3600);
    expect(ACCESS_TOKEN_TTL_SECONDS).toBe(3600);
    expect(issued).not.toHaveProperty("refreshToken");
    const c = claimsOf(issued.token);
    expect((c.exp as number) - (c.iat as number)).toBe(3600);
    expect(c.purpose).toBe("access_token");
    expect(await verifyAccessToken(auth, { baseURL, token: issued.token })).toEqual({ ok: true, registrationId, jti: issued.jti, expiresAt: issued.expiresAt });
  });
});

describe("the two kinds cannot be swapped", () => {
  it("an access token is refused as an assertion", async () => {
    const access = await issueAccessToken(auth, { baseURL, registrationId });
    expect(await verifyIdentityAssertion(auth, { baseURL, token: access.token })).toEqual({ ok: false, reason: "invalid" });
  });

  it("an assertion is refused as an access token", async () => {
    const assertion = await issueIdentityAssertion(auth, { baseURL, registrationId });
    expect(await verifyAccessToken(auth, { baseURL, token: assertion.token })).toEqual({ ok: false, reason: "invalid" });
  });

  it("they differ in issuer, audience and purpose, not only in purpose", async () => {
    const a = claimsOf((await issueIdentityAssertion(auth, { baseURL, registrationId })).token);
    const t = claimsOf((await issueAccessToken(auth, { baseURL, registrationId })).token);
    expect(a.iss).not.toBe(t.iss);
    expect(a.aud).not.toEqual(t.aud);
    expect(a.purpose).not.toBe(t.purpose);
  });

  it("a person's session token from the same plugin passes neither", async () => {
    // What the plugin mints for a signed-in person: issuer and audience are the site, sub is a user id, no purpose.
    const { token } = await auth.api.signJWT({ body: { payload: { sub: "user_1", iat: Math.floor(Date.now() / 1000) } } });
    expect(await verifyIdentityAssertion(auth, { baseURL, token })).toEqual({ ok: false, reason: "invalid" });
    expect(await verifyAccessToken(auth, { baseURL, token })).toEqual({ ok: false, reason: "invalid" });
  });
});

describe("refusals", () => {
  const twoHoursAgo = () => new Date(Date.now() - 2 * 60 * 60 * 1000);

  it("refuses an expired access token, and says it expired so the agent trades again", async () => {
    const old = await issueAccessToken(auth, { baseURL, registrationId, now: twoHoursAgo() });
    expect(await verifyAccessToken(auth, { baseURL, token: old.token })).toEqual({ ok: false, reason: "expired" });
  });

  it("refuses an expired assertion", async () => {
    const old = await issueIdentityAssertion(auth, { baseURL, registrationId, now: new Date(Date.now() - 366 * 24 * 60 * 60 * 1000) });
    expect(await verifyIdentityAssertion(auth, { baseURL, token: old.token })).toEqual({ ok: false, reason: "expired" });
  });

  it("refuses a wrong issuer", async () => {
    const forged = await auth.api.signJWT({ body: { payload: {
      ...claimsOf((await issueAccessToken(auth, { baseURL, registrationId })).token),
      iss: "https://elsewhere.example",
    } } });
    expect(await verifyAccessToken(auth, { baseURL, token: forged.token })).toEqual({ ok: false, reason: "invalid" });
  });

  it("refuses a wrong audience, even when it keeps the site origin", async () => {
    const claims = claimsOf((await issueAccessToken(auth, { baseURL, registrationId })).token);
    const forged = await auth.api.signJWT({ body: { payload: { ...claims, aud: [baseURL, "https://elsewhere.example/"] } } });
    expect(await verifyAccessToken(auth, { baseURL, token: forged.token })).toEqual({ ok: false, reason: "invalid" });
  });

  it("refuses an assertion with a wrong issuer", async () => {
    const claims = claimsOf((await issueIdentityAssertion(auth, { baseURL, registrationId })).token);
    const forged = await auth.api.signJWT({ body: { payload: { ...claims, iss: "https://elsewhere.example" } } });
    expect(await verifyIdentityAssertion(auth, { baseURL, token: forged.token })).toEqual({ ok: false, reason: "invalid" });
  });

  it("refuses an assertion with a wrong audience, even when it keeps the site origin", async () => {
    const claims = claimsOf((await issueIdentityAssertion(auth, { baseURL, registrationId })).token);
    const forged = await auth.api.signJWT({ body: { payload: { ...claims, aud: [baseURL, "https://elsewhere.example/token"] } } });
    expect(await verifyIdentityAssertion(auth, { baseURL, token: forged.token })).toEqual({ ok: false, reason: "invalid" });
  });

  it("refuses a token signed by another server's key", async () => {
    const other = buildAuth({ clientId: "test", secret: "other-secret-".padEnd(40, "y"), baseURL });
    const foreign = await issueAccessToken(other, { baseURL, registrationId });
    expect(await verifyAccessToken(auth, { baseURL, token: foreign.token })).toEqual({ ok: false, reason: "invalid" });
  });

  it("refuses a token whose subject is not a registration", async () => {
    const claims = claimsOf((await issueAccessToken(auth, { baseURL, registrationId })).token);
    const forged = await auth.api.signJWT({ body: { payload: { ...claims, sub: "user_1" } } });
    expect(await verifyAccessToken(auth, { baseURL, token: forged.token })).toEqual({ ok: false, reason: "invalid" });
  });

  it("refuses garbage without throwing", async () => {
    for (const token of ["", "a.b", "not.a.token", "x.y.z.w"]) {
      expect(await verifyAccessToken(auth, { baseURL, token })).toEqual({ ok: false, reason: "invalid" });
    }
  });

  it("refuses to mint for an id that is not a registration", async () => {
    await expect(issueAccessToken(auth, { baseURL, registrationId: "user_1" })).rejects.toThrow("Agent tokens are issued only to registration ids");
  });
});

describe("a key store that cannot be read is not a forged token", () => {
  // The plugin's verifier turns every failure, including an unreadable key table, into null. Reporting that as
  // "invalid" would tell the agent to delete its only credential during an outage, so it must come back as
  // "unavailable", which the route answers with a retryable error.
  it("reports unavailable when the key table cannot be read", async () => {
    const { token } = await issueIdentityAssertion(auth, { baseURL, registrationId });
    const down = {
      api: {
        signJWT: auth.api.signJWT,
        verifyJWT: async () => ({ payload: null }),
        getJwks: async () => { throw new Error("connection refused"); },
      },
    };
    expect(await verifyIdentityAssertion(down, { baseURL, token })).toEqual({ ok: false, reason: "unavailable" });
  });

  it("reports unavailable when the verifier itself throws", async () => {
    const { token } = await issueAccessToken(auth, { baseURL, registrationId });
    const broken = { api: { signJWT: auth.api.signJWT, verifyJWT: async () => { throw new Error("boom"); }, getJwks: auth.api.getJwks } };
    expect(await verifyAccessToken(broken, { baseURL, token })).toEqual({ ok: false, reason: "unavailable" });
  });
});
