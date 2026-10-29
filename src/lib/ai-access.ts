/**
 * Which AI apps (ChatGPT, Claude, Grok...) the user let use Queue Pilot, and revoking one.
 * Revoking removes the approval AND that app's refresh and access tokens for this user. Removing the approval alone
 * (Better Auth's delete-consent) would leave the app's refresh token working for up to 30 days. Access tokens are signed
 * JWTs that verify on their own, so the connector also calls stillApproved on every request: a revoked app stops at once.
 */
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { oauthAccessToken, oauthClient, oauthConsent, oauthRefreshToken, user } from "../db/auth-schema";
import { aiAppUse, securityEvent } from "../db/schema";

/** An AI app the person approved for the connector, with when it last called Queue Pilot. */
export type ApprovedApp = {
  consentId: string;
  name: string;
  site: string | null;
  approvedAt: string;
  /** When the app last called the connector, or null when it has not used Queue Pilot since it was approved. */
  lastUsedAt: string | null;
  calls: number;
};

/** The user's approved apps, newest first, with the name and site the app registered. */
export async function approvedApps(userId: string): Promise<ApprovedApp[]> {
  const rows = await db()
    .select({ consentId: oauthConsent.id, name: oauthClient.name, uri: oauthClient.uri, clientId: oauthConsent.clientId, createdAt: oauthConsent.createdAt, lastUsedAt: aiAppUse.lastUsedAt, calls: aiAppUse.calls })
    .from(oauthConsent)
    .leftJoin(oauthClient, eq(oauthClient.clientId, oauthConsent.clientId))
    .leftJoin(aiAppUse, and(eq(aiAppUse.userId, oauthConsent.userId), eq(aiAppUse.clientId, oauthConsent.clientId)))
    .where(eq(oauthConsent.userId, userId))
    .orderBy(desc(oauthConsent.createdAt));
  return rows.map((r) => ({
    consentId: r.consentId,
    name: r.name?.trim() || "An AI app",
    site: r.uri ?? null,
    approvedAt: r.createdAt.toISOString(),
    lastUsedAt: r.lastUsedAt ? r.lastUsedAt.toISOString() : null,
    calls: r.calls ?? 0,
  }));
}

/**
 * Records one connector call by an approved AI app, so the person can see which apps really use Queue Pilot.
 *
 * @param userId - The person the token belongs to
 * @param clientId - The AI app's OAuth client id
 * @param now - Current time; injectable for tests
 */
export async function recordAppUse(userId: string, clientId: string, now: Date = new Date()): Promise<void> {
  await db()
    .insert(aiAppUse)
    .values({ userId, clientId, firstUsedAt: now, lastUsedAt: now, calls: 1 })
    .onConflictDoUpdate({ target: [aiAppUse.userId, aiAppUse.clientId], set: { lastUsedAt: now, calls: sql`${aiAppUse.calls} + 1` } });
}

/** Revokes one approved app for this user only. Returns false when the approval is not this user's (or is gone). */
export async function revokeApp(userId: string, consentId: string): Promise<boolean> {
  return db().transaction(async (tx) => {
    const [consent] = await tx
      .select({ clientId: oauthConsent.clientId, name: oauthClient.name })
      .from(oauthConsent)
      .leftJoin(oauthClient, eq(oauthClient.clientId, oauthConsent.clientId))
      .where(and(eq(oauthConsent.id, consentId), eq(oauthConsent.userId, userId)));
    if (!consent) return false;
    await tx.delete(oauthRefreshToken).where(and(eq(oauthRefreshToken.userId, userId), eq(oauthRefreshToken.clientId, consent.clientId)));
    await tx.delete(oauthAccessToken).where(and(eq(oauthAccessToken.userId, userId), eq(oauthAccessToken.clientId, consent.clientId)));
    await tx.delete(oauthConsent).where(and(eq(oauthConsent.id, consentId), eq(oauthConsent.userId, userId)));
    await tx.delete(aiAppUse).where(and(eq(aiAppUse.userId, userId), eq(aiAppUse.clientId, consent.clientId)));
    await tx.insert(securityEvent).values({ userId, event: "app_revoked", detail: { app: consent.name?.trim() || "An AI app" } });
    return true;
  });
}

/**
 * True while the user still has an approval for this app and is not banned; the connector checks it on every request.
 * Better Auth checks a ban only when a session starts, and an AI app keeps working on refresh tokens, so the ban is
 * checked here too. A ban whose end date has passed no longer counts, as in Better Auth.
 */
export async function stillApproved(userId: string, clientId: string): Promise<boolean> {
  const [row] = await db()
    .select({ id: oauthConsent.id })
    .from(oauthConsent)
    .innerJoin(user, eq(user.id, oauthConsent.userId))
    .where(and(
      eq(oauthConsent.userId, userId),
      eq(oauthConsent.clientId, clientId),
      sql`(${user.banned} is not true or (${user.banExpires} is not null and ${user.banExpires} < now()))`,
    ))
    .limit(1);
  return !!row;
}
