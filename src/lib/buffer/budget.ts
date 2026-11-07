/**
 * @fileoverview Shared Buffer request accounting. Buffer counts every request of this app's client together, for all
 * people, in rolling 15-minute, 24-hour and 30-day windows, and reports what is left on each response. Every outbound
 * Buffer request reserves a slot here first, in Postgres, so all server instances and all people share one count:
 *
 * - A request reserves only when every window, minus the requests already on their way, is above the caller's reserve.
 *   Assistant tool calls and background jobs keep TOOL_RESERVE back for the person's own app; the app stops at zero.
 * - Buffer's answer removes the reservation. A reading only lowers what is left within a window; it can raise it only
 *   from a request that started after that window's stored reset, so a late or older answer never gives back spent
 *   requests. A known window an answer does not report (all of them after a network error or 5xx) is charged one,
 *   and a reservation that expires without an answer is charged once, never refunded.
 * - With no current reading (none yet, or a window past its stored reset), assistant calls go one at a time until
 *   Buffer reports again, waiting briefly for the slot instead of failing.
 * - Each person's assistant requests are counted per 15 minutes (PER_PERSON), so one person's burst is paced while
 *   others keep access. The windows are fixed, so a burst across a boundary can reach twice the cap.
 * - Waiting for the shared lock and each statement is time-bounded, so a stuck holder cannot stall every call; if the
 *   count cannot be read or written, the request is not sent.
 *
 * withBudget scopes one tool call or job: it carries the person and reserve, counts its requests, and logs the total.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { eq, gt, inArray, lte, sql } from "drizzle-orm";
import { db } from "../../db";
import { bufferAllowance, bufferReservation, requestCount } from "../../db/schema";
import type { RateLimitWindow } from "./client";
import { windowOfKey } from "./rate-limit-window";

/** Requests left in a window at which assistant calls and background jobs stop, leaving the rest to the person's app. */
export const TOOL_RESERVE = 15;
/** Most Buffer requests one person's assistants may make per 15 minutes. */
export const PER_PERSON = { max: 40, windowSeconds: 900 };
/** A reservation whose request never answered stops counting after this long (requests time out sooner, see client). */
const RESERVATION_MS = 60_000;
/** How long an assistant request waits for the single in-flight slot while the allowance is unknown. */
const UNKNOWN_WAIT = { tries: 20, ms: 250 };

/** Serializes reservations across instances for the length of one transaction. */
const LOCK = sql`select pg_advisory_xact_lock(hashtext('qp_buffer_allowance'))`;
/** A stuck holder must not stall every Buffer call: waiting for the lock and each statement are both bounded. */
const BOUNDS = [sql`set local lock_timeout = '2s'`, sql`set local statement_timeout = '5s'`];

/** One tool call's or job's accounting. */
type Scope = { tool: string; userId: string; requests: number; reserve: number };
const scope = new AsyncLocalStorage<Scope>();

/** Thrown before calling Buffer when a window, or the person's own pace, is used up for now. */
export class BufferAllowanceLowError extends Error {
  constructor(readonly remaining: number, readonly retryAt: Date) {
    super(`Buffer's request allowance is nearly used up (${remaining} left until ${retryAt.toISOString().slice(11, 16)} UTC). Queue Pilot keeps the rest for your own app, so assistant actions pause until then.`);
    this.name = "BufferAllowanceLowError";
  }
}

/** Thrown when the shared count cannot be read, written or confirmed: the request is not sent uncounted. */
export class BufferAllowanceUnknownError extends Error {
  constructor() {
    super("Queue Pilot cannot confirm Buffer's request allowance just now, so it is not calling Buffer. Try again in a minute.");
    this.name = "BufferAllowanceUnknownError";
  }
}

/**
 * Runs one tool call or background job inside its own accounting scope.
 *
 * @param tool - The connector tool's or job's name
 * @param userId - The person it acts for
 * @param run - The work
 * @returns The result and how many Buffer requests it made, also logged when it fails
 */
export async function withBudget<T>(tool: string, userId: string, run: () => Promise<T>, reserve = TOOL_RESERVE): Promise<{ result: T; requests: number }> {
  const s: Scope = { tool, userId, requests: 0, reserve };
  try {
    return { result: await scope.run(s, run), requests: s.requests };
  } finally {
    console.info(JSON.stringify({ event: "qp-tool-buffer-requests", tool, bufferRequests: s.requests }));
  }
}

/** One attempt at a reservation: the id, a refusal, or "unknown" (wait for the single slot and try again). */
async function tryReserve(id: string, now: number, s: Scope | undefined): Promise<"ok" | "unknown" | BufferAllowanceLowError> {
  const at = new Date(now);
  const reserve = s?.reserve ?? 0;
  return db().transaction(async (tx) => {
    for (const b of BOUNDS) await tx.execute(b);
    await tx.execute(LOCK);
    // A reservation that never released may still have been spent: charge it once as it expires, never refund it.
    const expired = await tx.delete(bufferReservation).where(lte(bufferReservation.expiresAt, at)).returning({ id: bufferReservation.id });
    if (expired.length) await tx.update(bufferAllowance).set({ remaining: sql`greatest(${bufferAllowance.remaining} - ${expired.length}, 0)` }).where(gt(bufferAllowance.resetAt, at));
    const [{ n: inFlight }] = await tx.select({ n: sql<number>`count(*)::int` }).from(bufferReservation);
    const all = await tx.select().from(bufferAllowance);
    const live = all.filter((w) => w.resetAt > at);
    if (s && (live.length === 0 || live.length < all.length) && inFlight > 0) return "unknown";
    const low = live.filter((w) => w.remaining - inFlight <= reserve).sort((a, b) => b.resetAt.getTime() - a.resetAt.getTime())[0];
    if (low) return new BufferAllowanceLowError(Math.max(0, low.remaining - inFlight), low.resetAt);
    if (s) {
      const start = Math.floor(now / (PER_PERSON.windowSeconds * 1000)) * PER_PERSON.windowSeconds * 1000;
      const [row] = await tx.insert(requestCount).values({ key: s.userId, action: "bufferRequest", bucket: new Date(start), count: 1 })
        .onConflictDoUpdate({ target: [requestCount.key, requestCount.action, requestCount.bucket], set: { count: sql`${requestCount.count} + 1` } })
        .returning({ count: requestCount.count });
      // Thrown, so the transaction rolls back and a refused request does not count against the person.
      if ((row?.count ?? 1) > PER_PERSON.max) throw new BufferAllowanceLowError(0, new Date(start + PER_PERSON.windowSeconds * 1000));
    }
    await tx.insert(bufferReservation).values({ id, userId: s?.userId ?? null, startedAt: at, expiresAt: new Date(now + RESERVATION_MS) });
    return "ok";
  });
}

/**
 * Reserves one outbound Buffer request. Call immediately before sending.
 *
 * @param now - Current time in milliseconds
 * @returns The reservation id, to pass to releaseRequest
 * @throws BufferAllowanceLowError when a window or the person's pace is used up; BufferAllowanceUnknownError when the
 *   count is unavailable or stays unknown
 */
export async function reserveRequest(now: number, wait: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))): Promise<string> {
  const s = scope.getStore();
  const id = randomUUID();
  for (let attempt = 0; attempt < UNKNOWN_WAIT.tries; attempt++) {
    let outcome: Awaited<ReturnType<typeof tryReserve>>;
    try {
      outcome = await tryReserve(id, now + attempt * UNKNOWN_WAIT.ms, s);
    } catch (e) {
      if (e instanceof BufferAllowanceLowError) throw e;
      console.error(JSON.stringify({ event: "qp-buffer-allowance-failed", message: e instanceof Error ? e.message : String(e) }));
      throw new BufferAllowanceUnknownError();
    }
    if (outcome instanceof BufferAllowanceLowError) throw outcome;
    if (outcome === "ok") {
      if (s) s.requests++;
      return id;
    }
    await wait(UNKNOWN_WAIT.ms);
  }
  throw new BufferAllowanceUnknownError();
}

/**
 * Removes a reservation and folds in what Buffer just reported. Never throws: the request already happened.
 *
 * @param id - From reserveRequest
 * @param windows - Buffer's RateLimit windows from the answer, or none when there was no reading
 * @param now - Current time in milliseconds
 */
export async function releaseRequest(id: string, windows: RateLimitWindow[], now: number): Promise<void> {
  const at = new Date(now);
  try {
    await db().transaction(async (tx) => {
      for (const b of BOUNDS) await tx.execute(b);
      await tx.execute(LOCK);
      // A reservation that already expired was charged then; its answer may only lower a window, never raise one.
      const [held] = await tx.delete(bufferReservation).where(eq(bufferReservation.id, id)).returning({ startedAt: bufferReservation.startedAt });
      if (held) {
        // Every known window the answer did not report (none at all after a network error or 5xx) is charged one.
        const reported = new Set(windows.map((w) => w.policy));
        const missing = (await tx.select({ policy: bufferAllowance.policy }).from(bufferAllowance).where(gt(bufferAllowance.resetAt, at))).map((r) => r.policy).filter((p) => !reported.has(p));
        if (missing.length) await tx.update(bufferAllowance).set({ remaining: sql`greatest(${bufferAllowance.remaining} - 1, 0)` }).where(inArray(bufferAllowance.policy, missing));
      }
      // Buffer changes a window's quota (and so its name) as the app gains authorized users. A reading keyed by window
      // length replaces what is stored for that window: rows from before windows were keyed by length, and a row
      // with the old quota last seen before this request started. A row seen after it is newer than this answer,
      // which then leaves that window alone.
      const keyed = windows.filter((w) => w.windowSeconds !== undefined);
      const stale = new Set<string>();
      if (keyed.length && held) {
        const stored = await tx.select({ policy: bufferAllowance.policy, observedAt: bufferAllowance.observedAt }).from(bufferAllowance);
        for (const row of stored) {
          const length = windowOfKey(row.policy);
          if (length === null) { await tx.delete(bufferAllowance).where(eq(bufferAllowance.policy, row.policy)); continue; }
          const reading = keyed.find((w) => w.windowSeconds === length);
          if (!reading || reading.policy === row.policy) continue;
          if (row.observedAt.getTime() <= held.startedAt.getTime()) await tx.delete(bufferAllowance).where(eq(bufferAllowance.policy, row.policy));
          else stale.add(reading.policy);
        }
      }
      for (const w of windows) {
        if (stale.has(w.policy)) continue;
        // A window may rise only from a request that started after its stored reset; anything older can only lower it.
        const rolled = held ? sql`${bufferAllowance.resetAt} <= ${held.startedAt.toISOString()}::timestamptz` : sql`false`;
        await tx.insert(bufferAllowance).values({ policy: w.policy, remaining: w.remaining, resetAt: new Date(now + w.resetSeconds * 1000), observedAt: at })
          .onConflictDoUpdate({
            target: bufferAllowance.policy,
            set: {
              remaining: sql`case when ${rolled} then excluded.remaining else least(${bufferAllowance.remaining}, excluded.remaining) end`,
              resetAt: sql`case when ${rolled} or excluded.remaining < ${bufferAllowance.remaining} then excluded.reset_at else ${bufferAllowance.resetAt} end`,
              observedAt: at,
            },
          });
      }
    });
  } catch (e) {
    console.error(JSON.stringify({ event: "qp-buffer-allowance-release-failed", message: e instanceof Error ? e.message : String(e) }));
  }
}

/**
 * The shared allowance as last reported, with when it was read; null before Buffer has ever reported it. A window
 * past its stored reset keeps its last value (reset 0) until a request started after the reset reports a new one.
 */
export async function currentAllowance(now: number = Date.now()): Promise<{ windows: RateLimitWindow[]; at: number } | null> {
  const rows = await db().select().from(bufferAllowance);
  if (!rows.length) return null;
  return {
    windows: rows.map((r) => ({ policy: r.policy, remaining: r.remaining, resetSeconds: Math.max(0, Math.round((r.resetAt.getTime() - now) / 1000)) })),
    at: Math.max(...rows.map((r) => r.observedAt.getTime())),
  };
}
