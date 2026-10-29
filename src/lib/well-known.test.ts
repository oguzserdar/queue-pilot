import { describe, expect, it } from "vitest";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { jwt } from "better-auth/plugins";
import { mcp } from "@better-auth/mcp";
import { forwardDiscovery, openIdConfiguration } from "./well-known";

// A real Better Auth instance with the same discovery plugins as production, mounted under /api/auth.
const base = "https://qp.example";
const auth = betterAuth({
  secret: "test-secret-test-secret-test-secret-1234",
  baseURL: base,
  // The memory adapter needs a table per model; the OAuth plugins add several, so create each on first use.
  database: memoryAdapter(new Proxy({} as Record<string, unknown[]>, { get: (t, k: string) => (t[k] ??= []) })),
  plugins: [jwt(), mcp({ loginPage: "/sign-in", consentPage: "/consent", resource: `${base}/api/mcp` })],
});

const get = (path: string) => new Request(`${base}${path}`, { method: "GET" });

describe("OAuth discovery at the site root", () => {
  it("serves protected resource metadata at the resource-path alias the 401 points to", async () => {
    const res = await forwardDiscovery(auth as never, get("/.well-known/oauth-protected-resource/api/mcp"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.resource).toBe(`${base}/api/mcp`);
    expect(body.authorization_servers).toEqual([`${base}/api/auth`]);
  });

  it("serves protected resource metadata at the bare root", async () => {
    const res = await forwardDiscovery(auth as never, get("/.well-known/oauth-protected-resource"));
    expect(res.status).toBe(200);
  });

  it("serves authorization server metadata at the issuer-inserted path", async () => {
    const res = await forwardDiscovery(auth as never, get("/.well-known/oauth-authorization-server/api/auth"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.issuer).toBe(`${base}/api/auth`);
    expect(body.code_challenge_methods_supported).toContain("S256");
  });

  it("serves openid-configuration at the root form", async () => {
    const res = await openIdConfiguration(auth as never, get("/.well-known/openid-configuration/api/auth"));
    expect(res.status).toBe(200);
    expect((await res.json()).issuer).toBe(`${base}/api/auth`);
  });

  it("answers 503, not a crash, before sign-in is configured", async () => {
    const res = await forwardDiscovery(null, get("/.well-known/oauth-protected-resource/api/mcp"));
    expect(res.status).toBe(503);
  });
});
