/**
 * @fileoverview Buffer request accounting for AI tool calls. Every Buffer response carries the person's remaining
 * allowance (rolling 15-minute, 24-hour and 30-day windows); this module keeps the newest reading per Buffer
 * connection, counts the requests each connector tool makes, and stops a tool before it calls Buffer when a window
 * is down to its reserve, so the person's own app keeps working after an assistant has been busy.
 *
 * The readings live in this server process only. That is enough for the guard: Buffer still refuses at zero, and the
 * guard only has to stop a burst from one assistant, which runs its calls through the same process.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import type { RateLimitWindow } from "./client";

/** Requests left in a window at which assistant tool calls stop, leaving the rest to the person's own app. */
export const TOOL_RESERVE = 15;

/** One tool call's accounting: which tool, how many Buffer requests it made, and the reserve it must leave. */
type Budget = { tool: string; requests: number; reserve: number };

const scope = new AsyncLocalStorage<Budget>();
const latest = new Map<string, { windows: RateLimitWindow[]; at: number }>();

/** A Buffer token never becomes a map key as itself. */
const keyOf = (token: string) => createHash("sha256").update(token).digest("hex").slice(0, 32);

/** Thrown before calling Buffer when a window is down to the reserve an assistant must leave. */
export class BufferAllowanceLowError extends Error {
  constructor(readonly remaining: number, readonly retryAt: Date) {
    super(`Buffer's request allowance is nearly used up (${remaining} left until ${retryAt.toISOString().slice(11, 16)} UTC). Queue Pilot keeps the rest for your own app, so assistant actions pause until then.`);
    this.name = "BufferAllowanceLowError";
  }
}

/**
 * Runs one tool call inside its own accounting scope.
 *
 * @param tool - The connector tool's name
 * @param run - The tool's work
 * @returns The tool's result and how many Buffer requests it made, also when it failed
 */
export async function withBudget<T>(tool: string, run: () => Promise<T>, reserve = TOOL_RESERVE): Promise<{ result: T; requests: number }> {
  const budget: Budget = { tool, requests: 0, reserve };
  try {
    const result = await scope.run(budget, run);
    return { result, requests: budget.requests };
  } finally {
    console.info(JSON.stringify({ event: "qp-tool-buffer-requests", tool, bufferRequests: budget.requests }));
  }
}

/** Saves the windows Buffer just reported for this connection. */
export function recordWindows(token: string, windows: RateLimitWindow[], at: number): void {
  if (windows.length) latest.set(keyOf(token), { windows, at });
}

/** The newest windows Buffer reported for this connection in this process, with when they were read. */
export function latestWindows(token: string): { windows: RateLimitWindow[]; at: number } | null {
  return latest.get(keyOf(token)) ?? null;
}

/**
 * Called before each Buffer request. Outside a tool call it does nothing. Inside one it counts the request, and
 * throws BufferAllowanceLowError when the newest reading shows a window that has not reset yet at or under the reserve.
 */
export function beforeRequest(token: string, now: number): void {
  const budget = scope.getStore();
  if (!budget) return;
  const seen = latest.get(keyOf(token));
  const low = seen?.windows
    .map((w) => ({ remaining: w.remaining, resetAt: seen.at + w.resetSeconds * 1000 }))
    .filter((w) => w.resetAt > now && w.remaining <= budget.reserve)
    .sort((a, b) => b.resetAt - a.resetAt)[0];
  if (low) throw new BufferAllowanceLowError(low.remaining, new Date(low.resetAt));
  budget.requests++;
}

/** Test helper: forgets every reading. */
export function resetBudgetReadings(): void {
  latest.clear();
}
