/**
 * @fileoverview Whether a failed Buffer call is known to have sent nothing because Buffer, or Queue Pilot's own count
 * of Buffer's allowance, said to wait. Such a refusal ends a batch: the next call would be refused the same way, and
 * each try spends a request or a slot of the allowance. It differs from a network or server failure after sending,
 * where a write may have happened and must be checked before it is reported or tried again.
 */
import { BufferAllowanceLowError, BufferAllowanceUnknownError } from "./budget";
import { BufferRateLimitedError } from "./client";

/** A refusal before anything was written, and when to try again (null when unknown). */
export type WaitRefusal = { retryAt: Date | null; message: string };

/**
 * The wait Buffer or the shared allowance asked for, or null when the error is something else.
 *
 * @param e - The error a Buffer call threw
 */
export function waitRefusal(e: unknown): WaitRefusal | null {
  if (e instanceof BufferRateLimitedError || e instanceof BufferAllowanceLowError) return { retryAt: e.retryAt, message: e.message };
  if (e instanceof BufferAllowanceUnknownError) return { retryAt: null, message: e.message };
  return null;
}

/** The reason given for a draft a wait refusal stopped before it was sent. */
export function notSentReason(w: WaitRefusal): string {
  const when = w.retryAt ? ` after ${w.retryAt.toISOString().slice(11, 16)} UTC` : " in a minute";
  return `Not sent: Buffer's request limit says to wait, so Queue Pilot stopped before writing this draft. Nothing was saved for it. Try again${when}.`;
}
