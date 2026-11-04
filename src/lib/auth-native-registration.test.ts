import { describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({ db: () => ({}), schema: {} }));
vi.mock("better-auth/adapters/drizzle", async () => {
  const { memoryAdapter } = await import("better-auth/adapters/memory");
  const tables: Record<string, unknown[]> = Object.fromEntries(["user", "session", "account", "verification", "jwks", "rateLimit", "oauthClient", "oauthResource", "oauthClientResource", "oauthRefreshToken", "oauthAccessToken", "oauthConsent", "oauthClientAssertion"].map((name) => [name, []]));
  return { drizzleAdapter: () => memoryAdapter(tables) };
});
const { buildAuth } = await import("./auth");
const baseURL = "https://qp.example";
const auth = buildAuth({ clientId: "test", secret: "native-registration-test-".padEnd(40, "x"), baseURL });
async function register(redirect: string, extra: Record<string, unknown> = {}) {
  const res = await auth.handler(new Request(`${baseURL}/api/auth/oauth2/register`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_name: "Desktop test", redirect_uris: [redirect],
      grant_types: ["authorization_code", "refresh_token"], response_types: ["code"],
      token_endpoint_auth_method: "none", ...extra }),
  }));
  return { status: res.status, body: await res.json() };
}

describe("native MCP client registration through the real auth handler", () => {
  it.each(["http://localhost:8787/callback", "http://127.0.0.1:8787/callback", "http://[::1]:8787/callback"])("accepts an omitted application type for exact loopback %s", async (uri) => {
    const result = await register(uri);
    expect(result.status, JSON.stringify(result.body)).toBe(201);
    expect(result.body).toMatchObject({ application_type: "native", token_endpoint_auth_method: "none" });
    expect(result.body.client_id).toBeTruthy();
    const authorize = new URL(`${baseURL}/api/auth/oauth2/authorize`);
    authorize.search = new URLSearchParams({ client_id: result.body.client_id, redirect_uri: uri, response_type: "code", scope: "openid", state: "test-no-pkce" }).toString();
    const res = await auth.handler(new Request(authorize));
    const text = await res.text();
    expect(text + (res.headers.get("location") ?? "")).toMatch(/code_challenge|PKCE/i);
  });
  it("does not override an explicit web type", async () => {
    const result = await register("http://localhost:8787/callback", { application_type: "web" });
    expect(result.status).toBe(400);
    expect(result.body.error).toBe("invalid_redirect_uri");
  });
  it.each(["http://example.com/callback", "http://localhost.evil.example/callback", "http://localhost./callback", "http://user:pass@localhost/callback", "http://localhost/callback#fragment"])("rejects unsafe callback %s", async (uri) => {
    expect((await register(uri)).status).toBe(400);
  });
  it("keeps a remote HTTPS client as web", async () => {
    const result = await register("https://grok.com/connectors-oauth-exchange-code/");
    expect(result.status).toBe(201);
    expect(result.body.application_type).toBe("web");
  });
  it("rejects unsafe URIs even mixed with a valid loopback", async () => {
    expect((await register("http://localhost:8787/callback", { redirect_uris: ["http://localhost:8787/callback", "http://evil.example/callback"] })).status).toBe(400);
  });
});
