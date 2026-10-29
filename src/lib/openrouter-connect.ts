/**
 * "Connect OpenRouter": OpenRouter's OAuth PKCE flow (openrouter.ai/docs/guides/overview/auth/oauth). The person signs
 * in at OpenRouter and approves Queue Pilot, and OpenRouter returns an API key tied to their own account and credits.
 * Nobody copies a key. The verifier, the state and the user travel in a short-lived httpOnly cookie between the start
 * route and the callback, and the callback refuses anything that does not match all three.
 */
import { createHash, randomBytes } from "node:crypto";
import { providerOf } from "./ai-key-store";

/** The cookie that carries the PKCE verifier, state and user between start and callback. */
export const COOKIE = "qp_openrouter";
/** How long a connect attempt may take, in seconds. */
export const COOKIE_MAX_AGE_S = 600;
const AUTH_URL = "https://openrouter.ai/auth";
const KEYS_URL = "https://openrouter.ai/api/v1/auth/keys";

export class OpenRouterConnectError extends Error {}

/** A fresh PKCE verifier, its S256 challenge and a state value. */
export function startConnect(userId: string): { url: (callbackUrl: string) => string; cookie: string } {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const state = randomBytes(16).toString("base64url");
  return {
    url: (callbackUrl) => {
      const u = new URL(AUTH_URL);
      u.searchParams.set("callback_url", callbackUrl);
      u.searchParams.set("code_challenge", challenge);
      u.searchParams.set("code_challenge_method", "S256");
      u.searchParams.set("state", state);
      u.searchParams.set("key_label", "Queue Pilot");
      return u.toString();
    },
    cookie: [userId, state, verifier].join("."),
  };
}

/** The verifier from the cookie when the callback's state and the signed-in user match it, else null. */
export function verifierFor(cookie: string | undefined, state: string | null, userId: string): string | null {
  const [cookieUser, cookieState, verifier] = (cookie ?? "").split(".");
  if (!cookieUser || !cookieState || !verifier || !state) return null;
  return cookieUser === userId && cookieState === state ? verifier : null;
}

/** Exchanges the callback's code for the person's OpenRouter key. */
export async function exchangeCode(code: string, verifier: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const res = await fetchImpl(KEYS_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code, code_verifier: verifier, code_challenge_method: "S256" }),
    signal: AbortSignal.timeout(15_000),
  }).catch(() => {
    throw new OpenRouterConnectError("Could not reach OpenRouter. Try again.");
  });
  if (!res.ok) throw new OpenRouterConnectError(`OpenRouter did not accept the sign-in (${res.status}). Try again.`);
  const body = (await res.json().catch(() => null)) as { key?: unknown } | null;
  const key = typeof body?.key === "string" ? body.key : "";
  if (providerOf(key) !== "openrouter") throw new OpenRouterConnectError("OpenRouter answered without a key Queue Pilot recognises.");
  return key;
}
