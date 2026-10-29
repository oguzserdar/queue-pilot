/**
 * @fileoverview Security events: what the person sees under "Security activity" in Settings.
 *
 * Recording never throws: a failed write is logged and the action it describes still completes.
 */
import { desc, eq } from "drizzle-orm";
import { db } from "../db";
import { securityEvent } from "../db/schema";

export type SecurityEventKind = "sign_in" | "app_revoked" | "account_deleted";

export type SecurityEvent = {
  event: SecurityEventKind;
  detail: Record<string, string> | null;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
};

/**
 * Records one security event.
 *
 * @param userId - The person, or null for the anonymous "account deleted" record
 * @param event - What happened
 * @param extra - Optional detail (for example the AI app's name), IP address and browser
 */
export async function recordSecurityEvent(
  userId: string | null,
  event: SecurityEventKind,
  extra: { detail?: Record<string, string>; ip?: string | null; userAgent?: string | null } = {},
): Promise<void> {
  try {
    await db().insert(securityEvent).values({ userId, event, detail: extra.detail ?? null, ip: extra.ip ?? null, userAgent: extra.userAgent ?? null });
  } catch (e) {
    console.error(JSON.stringify({ event: "qp-security-event-write-failed", kind: event, message: e instanceof Error ? e.message : String(e) }));
  }
}

/**
 * The person's most recent security events, newest first.
 *
 * @param userId - The signed-in person
 * @param limit - How many to return
 */
export async function recentSecurityEvents(userId: string, limit = 20): Promise<SecurityEvent[]> {
  const rows = await db().select().from(securityEvent).where(eq(securityEvent.userId, userId)).orderBy(desc(securityEvent.createdAt)).limit(limit);
  return rows.map((r) => ({ event: r.event as SecurityEventKind, detail: r.detail ?? null, ip: r.ip, userAgent: r.userAgent, createdAt: r.createdAt.toISOString() }));
}
