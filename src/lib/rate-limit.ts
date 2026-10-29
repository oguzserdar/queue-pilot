/**
 * @fileoverview Request limits for Queue Pilot's own surfaces: the connector, Buffer writes, AI bursts, connect round
 * trips, account actions and the admin unlock.
 *
 * Fixed windows are counted in Postgres with one atomic upsert per check, so every server instance shares one count
 * without a separate cache service. Better Auth limits `/api/auth/*` itself (see `src/lib/auth.ts`).
 *
 * A database error lets the request through: a limiter that is down must not take the product down with it.
 */
import { lt, sql } from "drizzle-orm";
import { db } from "../db";
import { requestCount } from "../db/schema";

export type Rule = { max: number; windowSeconds: number };

export const RULES = {
  /** Connector calls without a valid token, per IP address. Counted on every 401, so token guessing is bounded. */
  mcpUnauthenticated: { max: 30, windowSeconds: 60 },
  /** Connector calls with a valid token, per person and AI app. */
  mcp: { max: 100, windowSeconds: 60 },
  /** Writes to Buffer, per person, so one person cannot spend the app-wide Buffer allowance. */
  bufferWrite: { max: 30, windowSeconds: 60 },
  /** AI actions in a burst, per person, on top of the daily allowance and the operator's budget. */
  ai: { max: 3, windowSeconds: 60 },
  /** Actions that fetch outside addresses (adding a feed, checking an AI key), per person. */
  outbound: { max: 30, windowSeconds: 3600 },
  /** OpenRouter and Discord connect round trips, per person. */
  connect: { max: 30, windowSeconds: 3600 },
  /** Tries at claiming a fresh deployment with its setup code, per person, so the code cannot be guessed. */
  adminClaim: { max: 5, windowSeconds: 3600 },
  /** Account deletion and signing out other devices, per person. */
  account: { max: 5, windowSeconds: 3600 },
} as const satisfies Record<string, Rule>;

export type Action = keyof typeof RULES;

export type Limited = {
  ok: boolean;
  /** The rule's maximum and window, for the RateLimit-Policy header. */
  max: number;
  windowSeconds: number;
  remaining: number;
  /** Seconds until this window ends. */
  resetSeconds: number;
};

/** The start of the fixed window that `now` falls in. */
export const bucketStart = (now: number, windowSeconds: number) => Math.floor(now / (windowSeconds * 1000)) * windowSeconds * 1000;

/**
 * Counts one request and says whether it is within the action's rule.
 *
 * @param action - Which rule applies
 * @param key - Who is counted: a user id, `userId:clientId`, or an IP address
 * @param now - Current time in milliseconds; injectable for tests
 * @returns Whether the request is allowed, with the numbers for the RateLimit headers
 */
export async function limit(action: Action, key: string, now: number = Date.now()): Promise<Limited> {
  const rule = RULES[action];
  const start = bucketStart(now, rule.windowSeconds);
  const resetSeconds = Math.max(1, Math.ceil((start + rule.windowSeconds * 1000 - now) / 1000));
  try {
    const [row] = await db()
      .insert(requestCount)
      .values({ key, action, bucket: new Date(start), count: 1 })
      .onConflictDoUpdate({ target: [requestCount.key, requestCount.action, requestCount.bucket], set: { count: sql`${requestCount.count} + 1` } })
      .returning({ count: requestCount.count });
    const count = row?.count ?? 1;
    return { ok: count <= rule.max, max: rule.max, windowSeconds: rule.windowSeconds, remaining: Math.max(0, rule.max - count), resetSeconds };
  } catch (e) {
    console.error(JSON.stringify({ event: "qp-rate-limit-store-failed", action, message: e instanceof Error ? e.message : String(e) }));
    return { ok: true, max: rule.max, windowSeconds: rule.windowSeconds, remaining: rule.max, resetSeconds };
  }
}

/**
 * Builds the response headers for a limit: `RateLimit-Policy` and `RateLimit` from the IETF draft
 * (draft-ietf-httpapi-ratelimit-headers), plus `Retry-After` on a refusal.
 *
 * @param action - The rule's name, used as the policy name
 * @param l - The result of {@link limit}
 * @returns Header names and values to set on the response
 */
export function limitHeaders(action: Action, l: Limited): Record<string, string> {
  return {
    "RateLimit-Policy": `"${action}";q=${l.max};w=${l.windowSeconds}`,
    RateLimit: `"${action}";r=${l.remaining};t=${l.resetSeconds}`,
    ...(l.ok ? {} : { "Retry-After": String(l.resetSeconds) }),
  };
}

/**
 * Deletes windows that ended more than a day ago. Run by the daily job.
 *
 * @param now - Current time in milliseconds; injectable for tests
 */
export async function pruneRequestCounts(now: number = Date.now()): Promise<void> {
  await db().delete(requestCount).where(lt(requestCount.bucket, new Date(now - 86_400_000)));
}
