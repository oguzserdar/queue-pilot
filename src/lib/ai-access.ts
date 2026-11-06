/**
 * Which AI apps (ChatGPT, Claude, Grok...) the user let use Queue Pilot, and revoking one.
 * Revoking removes the approval AND that app's refresh and access tokens for this user. Removing the approval alone
 * (Better Auth's delete-consent) would leave the app's refresh token working for up to 30 days. Access tokens are signed
 * JWTs that verify on their own, so the connector also calls stillApproved on every request: a revoked app stops at once.
 * A connection unused for UNUSED_DAYS stops the same way, and the person can remove such connections in one go.
 */
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { oauthAccessToken, oauthClient, oauthConsent, oauthRefreshToken, user } from "../db/auth-schema";
import { aiAppLabel, aiAppUse, securityEvent } from "../db/schema";
import { approvedClientBrand, consentIdentity, returnPlaces } from "./consent-identity";
import { MAX_LABEL, UNUSED_DAYS } from "./ai-app-limits";
import { capAppName, type ConnectedApp } from "./app-identity";
import { recordAction } from "./security-events";

export { MAX_LABEL, UNUSED_DAYS };

const unusedSince = (now: Date) => new Date(now.getTime() - UNUSED_DAYS * 86_400_000);

/** An AI app the person approved for the connector, with when it last called Queue Pilot. */
export type ApprovedApp = {
  consentId: string;
  name: string;
  brand?: string | null;
  site: string | null;
  approvedAt: string;
  /** When the app last called the connector, or null when it has not used Queue Pilot since it was approved. */
  lastUsedAt: string | null;
  calls: number;
  /** The name the person gave this connection, or null. */
  label: string | null;
  /** Where the app sends the person back to: "grok.com", "This computer". Tells two connections of one app apart. */
  returnsTo: string[];
  /** True once the connection has gone UNUSED_DAYS without a call; the connector no longer accepts it. */
  unused: boolean;
};

/** Display metadata only; call after validating the signed consent request and the user's session. */
export async function consentClientLabel(clientId: string): Promise<string> {
  let metadataHost: string | null = null;
  try {
    const url = new URL(clientId);
    if (url.origin === "https://chatgpt.com" && url.pathname === "/oauth/codex/client.json" && !url.username && !url.password && !url.search && !url.hash) return "Codex";
    if (url.protocol === "https:") metadataHost = url.hostname;
  } catch { /* An opaque id is not a useful application name. */ }
  // Preserve exact metadata-host branding; a self-declared client name is not verified branding.
  if (metadataHost && ["claude.ai", "chatgpt.com", "grok.com"].includes(metadataHost)) return metadataHost;
  const [client] = await db().select({ name: oauthClient.name }).from(oauthClient)
    .where(eq(oauthClient.clientId, clientId)).limit(1);
  if (client?.name?.trim()) return capAppName(client.name);
  return metadataHost ?? "An AI app";
}

/** The user's approved apps, newest first, with the name and site the app registered. */
export async function approvedApps(userId: string, now: Date = new Date()): Promise<ApprovedApp[]> {
  const rows = await db()
    .select({ consentId: oauthConsent.id, name: oauthClient.name, uri: oauthClient.uri, redirectUris: oauthClient.redirectUris, clientId: oauthConsent.clientId, createdAt: oauthConsent.createdAt, lastUsedAt: aiAppUse.lastUsedAt, calls: aiAppUse.calls, label: aiAppLabel.label })
    .from(oauthConsent)
    .leftJoin(oauthClient, eq(oauthClient.clientId, oauthConsent.clientId))
    .leftJoin(aiAppUse, and(eq(aiAppUse.userId, oauthConsent.userId), eq(aiAppUse.clientId, oauthConsent.clientId)))
    .leftJoin(aiAppLabel, and(eq(aiAppLabel.userId, oauthConsent.userId), eq(aiAppLabel.clientId, oauthConsent.clientId)))
    .where(eq(oauthConsent.userId, userId))
    .orderBy(desc(oauthConsent.createdAt));
  const cutoff = unusedSince(now);
  return rows.map((r) => ({
    consentId: r.consentId,
    name: capAppName(r.name ?? "") || "An AI app",
    brand: approvedClientBrand(r.name ?? "", r.clientId, r.redirectUris ?? []),
    site: r.uri ?? null,
    approvedAt: r.createdAt.toISOString(),
    lastUsedAt: r.lastUsedAt ? r.lastUsedAt.toISOString() : null,
    calls: r.calls ?? 0,
    label: r.label ?? null,
    returnsTo: returnPlaces(r.redirectUris ?? []),
    unused: (r.lastUsedAt ?? r.createdAt) < cutoff,
  }));
}

/**
 * Names one of this person's connections, or clears the name when given an empty one.
 *
 * @param userId - The signed-in person
 * @param consentId - The connection's approval id
 * @param label - The new name; trimmed, at most MAX_LABEL characters, empty to clear
 * @returns False when the connection is not this person's (or is gone)
 */
export async function renameApp(userId: string, consentId: string, label: string): Promise<boolean> {
  const name = label.trim().slice(0, MAX_LABEL);
  return db().transaction(async (tx) => {
    const [consent] = await tx.select({ clientId: oauthConsent.clientId }).from(oauthConsent)
      .where(and(eq(oauthConsent.id, consentId), eq(oauthConsent.userId, userId)));
    if (!consent) return false;
    if (!name) await tx.delete(aiAppLabel).where(and(eq(aiAppLabel.userId, userId), eq(aiAppLabel.clientId, consent.clientId)));
    else await tx.insert(aiAppLabel).values({ userId, clientId: consent.clientId, label: name })
      .onConflictDoUpdate({ target: [aiAppLabel.userId, aiAppLabel.clientId], set: { label: name, updatedAt: sql`now()` } });
    return true;
  });
}

/**
 * Removes every connection of this person's that has gone UNUSED_DAYS without a call.
 *
 * @param userId - The signed-in person
 * @param now - Current time; injectable for tests
 * @returns How many connections were removed
 */
export async function removeUnusedApps(userId: string, now: Date = new Date()): Promise<number> {
  const stale = (await approvedApps(userId, now)).filter((a) => a.unused);
  let removed = 0;
  for (const a of stale) if (await revokeApp(userId, a.consentId)) removed++;
  return removed;
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
    await tx.delete(aiAppLabel).where(and(eq(aiAppLabel.userId, userId), eq(aiAppLabel.clientId, consent.clientId)));
    await tx.insert(securityEvent).values({ userId, event: "app_revoked", detail: { app: consent.name?.trim() || "An AI app" } });
    return true;
  });
}

/**
 * Who an action by this connected app is recorded as. The brand ("claude.ai" becomes "Claude") is used only when the
 * app's registered address or metadata host proves it, the same check the consent page makes. Any other name is the
 * app's own claim and is kept unverified, capped in length.
 *
 * @param clientId - The AI app's OAuth client id
 * @returns The shown name and whether it was proven
 */
export async function connectedApp(clientId: string): Promise<ConnectedApp> {
  const label = await consentClientLabel(clientId);
  const [client] = await db().select({ redirectUris: oauthClient.redirectUris }).from(oauthClient)
    .where(eq(oauthClient.clientId, clientId)).limit(1);
  const redirects = client?.redirectUris ?? [];
  // With no registered callback (a metadata-document client), the metadata host alone can prove the brand.
  const brand = redirects.length ? approvedClientBrand(label, clientId, redirects) : consentIdentity(label, clientId, "").brand;
  return brand ? { name: brand, verified: true } : { name: capAppName(label), verified: false };
}

/**
 * Records "Connected <app>" in Security activity once the person's approval for that app exists, so a refused or
 * half-finished consent records nothing. Never throws.
 *
 * @param userId - The person who pressed Allow
 * @param clientId - The AI app's OAuth client id from the signed consent request
 */
export async function recordAppConnected(userId: string, clientId: string): Promise<void> {
  try {
    const [consent] = await db().select({ id: oauthConsent.id }).from(oauthConsent)
      .where(and(eq(oauthConsent.userId, userId), eq(oauthConsent.clientId, clientId))).limit(1);
    if (!consent) return;
    const app = await connectedApp(clientId);
    await recordAction(userId, "app_connected", { via: "ai", app: app.name, verified: app.verified });
  } catch (e) {
    console.error(JSON.stringify({ event: "qp-app-connected-record-failed", message: e instanceof Error ? e.message : String(e) }));
  }
}

/** Whether the connector may serve this app for this person right now. "unused" carries the approval to retire. */
export type ApprovalState = { state: "approved" } | { state: "unused"; consentId: string } | { state: "none" };

/**
 * Whether this person's approval for this app still lets it use the connector; the connector checks it on every
 * request. Better Auth checks a ban only when a session starts, and an AI app keeps working on refresh tokens, so the
 * ban is checked here too. A ban whose end date has passed no longer counts, as in Better Auth. An approval whose
 * last call (or, if it never called, its approval) is more than UNUSED_DAYS old is "unused": the connector retires it,
 * so reconnecting asks for a fresh approval instead of reusing the stale one.
 *
 * @param userId - The person the token belongs to
 * @param clientId - The AI app's OAuth client id
 * @param now - Current time; injectable for tests
 * @returns approved, unused (with the approval id), or none (no approval, or a banned person)
 */
export async function approvalState(userId: string, clientId: string, now: Date = new Date()): Promise<ApprovalState> {
  const [row] = await db()
    .select({ consentId: oauthConsent.id, createdAt: oauthConsent.createdAt, lastUsedAt: aiAppUse.lastUsedAt })
    .from(oauthConsent)
    .innerJoin(user, eq(user.id, oauthConsent.userId))
    .leftJoin(aiAppUse, and(eq(aiAppUse.userId, oauthConsent.userId), eq(aiAppUse.clientId, oauthConsent.clientId)))
    .where(and(
      eq(oauthConsent.userId, userId),
      eq(oauthConsent.clientId, clientId),
      sql`(${user.banned} is not true or (${user.banExpires} is not null and ${user.banExpires} < now()))`,
    ))
    .limit(1);
  if (!row) return { state: "none" };
  return (row.lastUsedAt ?? row.createdAt) < unusedSince(now) ? { state: "unused", consentId: row.consentId } : { state: "approved" };
}

/** True while the app may use the connector for this person: approved, not banned, and used within UNUSED_DAYS. */
export async function stillApproved(userId: string, clientId: string, now: Date = new Date()): Promise<boolean> {
  return (await approvalState(userId, clientId, now)).state === "approved";
}
