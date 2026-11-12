/**
 * Deletes everything Queue Pilot stores for one person. Every app table keyed by user_id references the user row with
 * ON DELETE CASCADE (src/db/schema.ts), so deleting that row removes their saved queue copy, sources, voice, copy
 * destinations and history, Buffer sign-in, sessions and AI approvals in one statement, and a write still in flight
 * for that person fails instead of recreating orphaned rows. The Telegram connect codes are not keyed by user; the
 * ones derived for this person (today and yesterday) are removed too. Nothing in Buffer is touched.
 *
 * The deployment's only admin cannot delete their account, the way an organization refuses to lose its last owner:
 * the deployment would be left with nobody to manage its keys. Make someone else admin first.
 */
import { eq, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import { user } from "../db/auth-schema";
import { securityEvent, telegramCode } from "../db/schema";
import { isAdminRole } from "./admin-role";
import { connectCodeFor } from "./telegram";

/** Thrown when the account to delete belongs to the deployment's only admin. Nothing was removed. */
export class LastAdminError extends Error {
  constructor() {
    super("You are this deployment's only admin. Make someone else admin first, then delete your account.");
    this.name = "LastAdminError";
  }
}

export async function deleteAccount(userId: string, telegramSecret?: string): Promise<void> {
  if (!userId) throw new Error("No user to delete");
  const now = Date.now();
  const codes = telegramSecret ? [now, now - 86_400_000].map((t) => connectCodeFor(userId, telegramSecret, new Date(t))) : [];
  await db().transaction(async (tx) => {
    // The same lock the first-admin claim takes, so a claim and a deletion cannot interleave.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('qp-first-admin'))`);
    const [me] = await tx.select({ role: user.role }).from(user).where(eq(user.id, userId));
    if (me && isAdminRole(me.role)) {
      // Locked, so a role change elsewhere waits for this check instead of leaving no admin.
      const admins = await tx.select({ id: user.id, role: user.role }).from(user).where(sql`${user.role} like '%admin%'`).for("update");
      if (!admins.some((a) => a.id !== userId && isAdminRole(a.role))) throw new LastAdminError();
    }
    if (codes.length) await tx.delete(telegramCode).where(inArray(telegramCode.code, codes));
    await tx.delete(user).where(eq(user.id, userId));
    // The person's own events go with the account; one anonymous row records that a deletion happened.
    await tx.insert(securityEvent).values({ userId: null, event: "account_deleted" });
  });
}
