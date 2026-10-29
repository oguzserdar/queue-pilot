/**
 * Deletes everything Queue Pilot stores for one person. Every app table keyed by user_id references the user row with
 * ON DELETE CASCADE (src/db/schema.ts), so deleting that row removes their saved queue copy, sources, voice, copy
 * destinations and history, Buffer sign-in, sessions and AI approvals in one statement, and a write still in flight
 * for that person fails instead of recreating orphaned rows. The Telegram connect codes are not keyed by user; the
 * ones derived for this person (today and yesterday) are removed too. Nothing in Buffer is touched.
 */
import { eq, inArray } from "drizzle-orm";
import { db } from "../db";
import { user } from "../db/auth-schema";
import { securityEvent, telegramCode } from "../db/schema";
import { connectCodeFor } from "./telegram";

export async function deleteAccount(userId: string, telegramSecret?: string): Promise<void> {
  if (!userId) throw new Error("No user to delete");
  const now = Date.now();
  const codes = telegramSecret ? [now, now - 86_400_000].map((t) => connectCodeFor(userId, telegramSecret, new Date(t))) : [];
  await db().transaction(async (tx) => {
    if (codes.length) await tx.delete(telegramCode).where(inArray(telegramCode.code, codes));
    await tx.delete(user).where(eq(user.id, userId));
    // The person's own events go with the account; one anonymous row records that a deletion happened.
    await tx.insert(securityEvent).values({ userId: null, event: "account_deleted" });
  });
}
