/**
 * @fileoverview The setup code that proves the person claiming a fresh deployment operates it. Signing in with Buffer
 * only proves who someone is, not that the deployment is theirs, so in production a claim always needs the server's
 * ADMIN_SETUP_CODE. Outside production a missing code still lets the first person claim, for local runs.
 */
import { createHash, timingSafeEqual } from "node:crypto";

/** Codes shorter than this are too easy to guess, so they never match. */
export const MIN_SETUP_CODE = 24;

/** Whether a claim may go ahead: the code matches, it does not, or this deployment has no usable code to check. */
export type SetupCodeCheck = "ok" | "wrong" | "not-configured";

type Env = Record<string, string | undefined>;

/**
 * Whether this deployment asks for a setup code on the claim form.
 *
 * @param env - The server's environment
 * @returns True in production, and anywhere a code is configured
 */
export function setupCodeRequired(env: Env = process.env): boolean {
  return env.NODE_ENV === "production" || Boolean(env.ADMIN_SETUP_CODE?.trim());
}

/**
 * Whether production has a setup code long enough to accept claims.
 *
 * @param env - The server's environment
 * @returns False in production when ADMIN_SETUP_CODE is missing, blank or shorter than MIN_SETUP_CODE
 */
export function setupCodeReady(env: Env = process.env): boolean {
  return env.NODE_ENV !== "production" || (env.ADMIN_SETUP_CODE?.trim().length ?? 0) >= MIN_SETUP_CODE;
}

/**
 * Checks a typed setup code against the server's, in constant time.
 *
 * @param typed - What the person typed
 * @param env - The server's environment
 * @returns "not-configured" in production without a usable code, "ok" when it matches (or outside production with
 *   no code set), else "wrong"
 */
export function checkSetupCode(typed: string, env: Env = process.env): SetupCodeCheck {
  const expected = env.ADMIN_SETUP_CODE?.trim() ?? "";
  if (!setupCodeReady(env)) return "not-configured";
  if (!expected) return "ok";
  if (expected.length < MIN_SETUP_CODE) return "wrong";
  const a = createHash("sha256").update(typed.trim()).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b) ? "ok" : "wrong";
}
