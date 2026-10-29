import { describe, expect, it, vi } from "vitest";

// Buffer refresh tokens are single-use. Every refresh must go through bufferAccessToken's lock, so the HTTP routes
// that refresh or hand out provider tokens are closed. The database is never reached: the router answers first.
vi.mock("../db", () => ({ db: () => ({}), schema: {} }));
vi.mock("better-auth/adapters/drizzle", async () => {
  const { memoryAdapter } = await import("better-auth/adapters/memory");
  // Every plugin's tables, created empty on first use.
  const tables = new Proxy({} as Record<string, unknown[]>, { get: (t, model: string) => (t[model] ??= []) });
  return { drizzleAdapter: () => memoryAdapter(tables) };
});

const { buildAuth } = await import("./auth");
const baseURL = "http://localhost:3000";
const auth = buildAuth({ clientId: "test", secret: "test-secret-".padEnd(40, "x"), baseURL });

const post = (path: string) =>
  auth.handler(new Request(`${baseURL}/api/auth${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: baseURL },
    body: JSON.stringify({ providerId: "buffer" }),
  }));

describe("Better Auth token routes", () => {
  it.each(["/refresh-token", "/get-access-token"])("answers 404 on %s so a browser cannot refresh outside the lock", async (path) => {
    expect((await post(path)).status).toBe(404);
  });

  it("keeps other auth routes open (control)", async () => {
    const res = await auth.handler(new Request(`${baseURL}/api/auth/get-session`, { headers: { origin: baseURL } }));
    expect(res.status).toBe(200);
  });
});

describe("Better Auth's rate limit in production", () => {
  it("stops a fourth sign-in from one address within 10 seconds, and the route sends a standard Retry-After", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { withRetryAfter } = await import("./retry-after");
    const prod = buildAuth({ clientId: "test", secret: "test-secret-".padEnd(40, "x"), baseURL });
    const signIn = () => prod.handler(new Request(`${baseURL}/api/auth/sign-in/social`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: baseURL, "x-forwarded-for": "203.0.113.7" },
      body: JSON.stringify({ provider: "buffer", callbackURL: "/" }),
    }));
    const statuses: number[] = [];
    let last: Response | null = null;
    for (let i = 0; i < 4; i++) { last = await signIn(); statuses.push(last.status); }
    expect(statuses.slice(0, 3)).not.toContain(429);
    expect(statuses[3]).toBe(429);
    const res = withRetryAfter(last!);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(Number(res.headers.get("retry-after"))).toBeLessThanOrEqual(10);
    vi.unstubAllEnvs();
  });
});

describe("Buffer sign-in request", () => {
  it("asks for offline_access with prompt=consent and PKCE, which Buffer needs to issue a refresh token", async () => {
    const res = await auth.handler(new Request(`${baseURL}/api/auth/sign-in/social`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: baseURL },
      body: JSON.stringify({ provider: "buffer", callbackURL: "/" }),
    }));
    const { url } = (await res.json()) as { url: string };
    const q = new URL(url).searchParams;
    expect(q.get("prompt")).toBe("consent");
    expect(q.get("scope")?.split(" ")).toContain("offline_access");
    expect(q.get("code_challenge_method")).toBe("S256");
  });
});

