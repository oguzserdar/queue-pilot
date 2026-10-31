/**
 * @fileoverview Saved AI answers for repeated fixes, so asking again about the same unchanged repeats costs no action.
 *
 * An answer is reused only for exactly the same check: the same prompt version and the same candidates with the same
 * drafts before and after, in the same order. Any new repeat, another edit to those drafts or a new prompt version
 * changes the key, so the model is asked again. Answers expire on their own: a day when every answer was clear
 * (preference or fact), ten minutes when any was unclear, so a doubtful answer gets another look soon. Only the
 * verdicts are saved, never suggestion tokens or rules.
 *
 * Before asking the model, a check claims its key with its own random token, so two checks of the same repeats at the
 * same moment cannot both spend an action: the second one is told the check is already running. A claim that is never
 * finished lapses after a minute, and the model call has a shorter deadline (ASK_DEADLINE_MS) so a live check finishes
 * first. Finishing or releasing works only while the row still holds that token, so a late check can never erase or
 * overwrite a newer one.
 *
 * Known limit: the AI model is not part of the key, because it is only known after an action is reserved. A change of
 * model takes effect when the saved answer expires, within a day.
 */
import { createHash, randomUUID } from "node:crypto";
import { and, eq, gt, lte, sql } from "drizzle-orm";
import { db } from "../db";
import { fixVerdict } from "../db/schema";
import { CONFIRM_VERSION, type Verdict } from "./confirm-fixes";
import type { FixOffer } from "./fixes";

export const CLEAR_TTL_MS = 24 * 60 * 60_000;
export const UNCLEAR_TTL_MS = 10 * 60_000;
export const CLAIM_TTL_MS = 60_000;
/** How long the model may take inside one claim; shorter than the claim, so the claim never lapses mid-check. */
export const ASK_DEADLINE_MS = 45_000;
const pending = (token: string) => ({ pending: token });

/**
 * The key for one exact check.
 *
 * @param offers - Candidates in the order the model sees them
 * @returns A hash of the prompt version and every candidate's fix, network, count and drafts
 */
export function checkKey(offers: FixOffer[]): string {
  const input = { v: CONFIRM_VERSION, offers: offers.map((o) => ({ fix: o.fix, network: o.network, count: o.count, examples: o.examples })) };
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

/** How long answers stay reusable: short when the model was unsure about any candidate. */
export function ttlFor(verdicts: Verdict[]): number {
  return verdicts.some((v) => v.verdict === "unclear") ? UNCLEAR_TTL_MS : CLEAR_TTL_MS;
}

export type Saved = { kind: "answer"; verdicts: Verdict[] } | { kind: "busy" } | null;

export type VerdictStore = {
  /** The saved answers for this exact check, "busy" while another check holds its claim, null when neither. */
  get(userId: string, key: string, now?: Date): Promise<Saved>;
  /** Claims the check before asking the model. Returns this claim's token, or null when a live claim or answer holds the key. */
  claim(userId: string, key: string, now?: Date): Promise<string | null>;
  /** Saves complete answers in place of this claim, only while the claim is still this token's. Clears expired rows. */
  put(userId: string, key: string, token: string, verdicts: Verdict[], now?: Date): Promise<void>;
  /** Drops this claim, only while it is still this token's, so the next check asks again. */
  release(userId: string, key: string, token: string): Promise<void>;
};

/** Saved answers in Postgres; every statement is scoped to the user id. */
export function postgresVerdictStore(): VerdictStore {
  const mine = (userId: string, key: string, token: string) =>
    and(eq(fixVerdict.userId, userId), eq(fixVerdict.inputHash, key), sql`${fixVerdict.verdicts} = ${JSON.stringify(pending(token))}::jsonb`);
  return {
    async get(userId, key, now = new Date()) {
      const [row] = await db().select({ verdicts: fixVerdict.verdicts }).from(fixVerdict)
        .where(and(eq(fixVerdict.userId, userId), eq(fixVerdict.inputHash, key), gt(fixVerdict.expiresAt, now)));
      if (!row) return null;
      return Array.isArray(row.verdicts) ? { kind: "answer", verdicts: row.verdicts as Verdict[] } : { kind: "busy" };
    },
    async claim(userId, key, now = new Date()) {
      const token = randomUUID();
      const expiresAt = new Date(now.getTime() + CLAIM_TTL_MS);
      const won = await db().insert(fixVerdict).values({ userId, inputHash: key, verdicts: pending(token), expiresAt })
        .onConflictDoUpdate({ target: [fixVerdict.userId, fixVerdict.inputHash], set: { verdicts: pending(token), expiresAt }, setWhere: lte(fixVerdict.expiresAt, now) })
        .returning({ key: fixVerdict.inputHash });
      return won.length > 0 ? token : null;
    },
    async put(userId, key, token, verdicts, now = new Date()) {
      const expiresAt = new Date(now.getTime() + ttlFor(verdicts));
      await db().update(fixVerdict).set({ verdicts, expiresAt }).where(mine(userId, key, token));
      await db().delete(fixVerdict).where(and(eq(fixVerdict.userId, userId), lte(fixVerdict.expiresAt, now)));
    },
    async release(userId, key, token) {
      await db().delete(fixVerdict).where(mine(userId, key, token));
    },
  };
}
