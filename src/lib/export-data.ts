/**
 * @fileoverview "Download my data": everything Queue Pilot stores about one person, as one JSON document.
 *
 * Each person may take their data with them (GDPR Article 20). The export reads only rows that belong to the person and
 * leaves out every secret: the encrypted AI key, Buffer and AI-app tokens, and session tokens.
 */
import { asc, eq } from "drizzle-orm";
import { db } from "../db";
import { session, user } from "../db/auth-schema";
import {
  aiKey,
  aiUsage,
  bufferSnapshot,
  echo,
  echoDestination,
  fixDismissed,
  rule,
  securityEvent,
  source,
  sourceUsed,
  voiceExample,
  voiceNote,
  written,
} from "../db/schema";
import { approvedApps } from "./ai-access";

/** Version of the export's shape, so a later import can tell what it reads. */
export const EXPORT_FORMAT = 1;

/**
 * Builds the person's export.
 *
 * @param userId - The signed-in person
 * @param now - When the export was made; injectable for tests
 * @returns A JSON-ready object, or null when the person no longer exists
 */
export async function exportUserData(userId: string, now: Date = new Date()) {
  const d = db();
  const [person] = await d.select({ name: user.name, email: user.email, image: user.image, createdAt: user.createdAt }).from(user).where(eq(user.id, userId));
  if (!person) return null;
  const [
    rules, voiceExamples, voiceNotes, sources, sourcesUsed, copies, copiedPosts, drafts, dismissed, ai, usage, security, sessions, snapshot, apps,
  ] = await Promise.all([
    d.select().from(rule).where(eq(rule.userId, userId)),
    d.select().from(voiceExample).where(eq(voiceExample.userId, userId)),
    d.select().from(voiceNote).where(eq(voiceNote.userId, userId)),
    d.select().from(source).where(eq(source.userId, userId)),
    d.select().from(sourceUsed).where(eq(sourceUsed.userId, userId)),
    d.select().from(echoDestination).where(eq(echoDestination.userId, userId)),
    d.select().from(echo).where(eq(echo.userId, userId)),
    d.select().from(written).where(eq(written.userId, userId)),
    d.select().from(fixDismissed).where(eq(fixDismissed.userId, userId)),
    d.select({ provider: aiKey.provider, model: aiKey.model, updatedAt: aiKey.updatedAt }).from(aiKey).where(eq(aiKey.userId, userId)),
    d.select().from(aiUsage).where(eq(aiUsage.userId, userId)),
    d.select().from(securityEvent).where(eq(securityEvent.userId, userId)).orderBy(asc(securityEvent.createdAt)),
    d.select({ createdAt: session.createdAt, expiresAt: session.expiresAt, ipAddress: session.ipAddress, userAgent: session.userAgent }).from(session).where(eq(session.userId, userId)),
    d.select({ data: bufferSnapshot.data, fetchedAt: bufferSnapshot.fetchedAt }).from(bufferSnapshot).where(eq(bufferSnapshot.userId, userId)),
    approvedApps(userId),
  ]);
  const strip = <T extends Record<string, unknown>>(rows: T[]) => rows.map(({ userId: _u, ...rest }) => rest);
  return {
    format: EXPORT_FORMAT,
    exportedAt: now.toISOString(),
    account: person,
    playbook: { rules: strip(rules), dismissedOffers: strip(dismissed) },
    voice: { examples: strip(voiceExamples), notes: strip(voiceNotes) },
    sources: { feeds: strip(sources), used: strip(sourcesUsed) },
    copies: { destinations: strip(copies), sent: strip(copiedPosts) },
    draftsQueuePilotWrote: strip(drafts),
    ai: { ownKey: ai[0] ?? null, builtInUsage: strip(usage) },
    aiApps: apps,
    securityActivity: strip(security),
    signedInBrowsers: sessions,
    bufferCopy: snapshot[0] ?? null,
  };
}
