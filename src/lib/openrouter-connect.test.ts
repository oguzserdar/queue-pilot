import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { exchangeCode, OpenRouterConnectError, startConnect, verifierFor } from "./openrouter-connect";

const KEY = `sk-or-v1-${"ab".repeat(32)}`;

describe("startConnect", () => {
  it("sends the person to OpenRouter with an S256 challenge of the verifier kept in the cookie", () => {
    const { url, cookie } = startConnect("u1");
    const [user, state, verifier] = cookie.split(".");
    const u = new URL(url("https://qp.example/api/openrouter/callback"));
    expect(u.origin + u.pathname).toBe("https://openrouter.ai/auth");
    expect(user).toBe("u1");
    expect(u.searchParams.get("state")).toBe(state);
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    expect(u.searchParams.get("code_challenge")).toBe(createHash("sha256").update(verifier).digest("base64url"));
    expect(u.searchParams.get("callback_url")).toBe("https://qp.example/api/openrouter/callback");
  });
});

describe("verifierFor", () => {
  it("returns the verifier only when the state and the signed-in user both match", () => {
    expect(verifierFor("u1.s1.v1", "s1", "u1")).toBe("v1");
    expect(verifierFor("u1.s1.v1", "s2", "u1")).toBeNull();
    expect(verifierFor("u1.s1.v1", "s1", "u2")).toBeNull();
    expect(verifierFor(undefined, "s1", "u1")).toBeNull();
    expect(verifierFor("u1.s1.v1", null, "u1")).toBeNull();
  });
});

describe("exchangeCode", () => {
  it("posts the code and verifier and returns the person's key", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ key: KEY }));
    expect(await exchangeCode("c1", "v1", fetchImpl as unknown as typeof fetch)).toBe(KEY);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://openrouter.ai/api/v1/auth/keys");
    expect(JSON.parse(init.body as string)).toEqual({ code: "c1", code_verifier: "v1", code_challenge_method: "S256" });
  });
  it("refuses an answer that is not an OpenRouter key", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ key: "sk-proj-something-else-entirely" }));
    await expect(exchangeCode("c1", "v1", fetchImpl as unknown as typeof fetch)).rejects.toBeInstanceOf(OpenRouterConnectError);
  });
  it("reports a refused code plainly", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 400 }));
    await expect(exchangeCode("c1", "v1", fetchImpl as unknown as typeof fetch)).rejects.toThrow("did not accept the sign-in (400)");
  });
});
