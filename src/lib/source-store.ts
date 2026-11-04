import { randomUUID } from "node:crypto";
import { and, desc, eq, gt, inArray, lte, sql } from "drizzle-orm";
import { db } from "../db";
import { draftEvidence, sourceJob, sourceSnapshot } from "../db/schema";
import { evidenceProblem, sourceHash, sourceVersionInput, verifyEvidence, type EvidenceInput, type SourceMetadata } from "./source-evidence";

export type SourceSnapshot = typeof sourceSnapshot.$inferSelect;
export type DraftEvidence = typeof draftEvidence.$inferSelect;
export class SourceBusyError extends Error { constructor() { super("This source is already being checked. Try again in a minute."); } }
const own = (userId: string, key: string) => and(eq(sourceJob.userId, userId), eq(sourceJob.key, key));

/** Every lease writer compares its random token. Expired workers cannot save or remove a successor's work. */
export async function claimSourceJob(userId: string, key: string, milliseconds = 60_000) {
  const token = randomUUID();
  const rows = await db().insert(sourceJob).values({ userId, key, token, expiresAt: new Date(Date.now() + milliseconds) })
    .onConflictDoUpdate({ target: [sourceJob.userId, sourceJob.key], set: { token, value: {}, expiresAt: new Date(Date.now() + milliseconds) }, setWhere: lte(sourceJob.expiresAt, new Date()) }).returning();
  return rows.length ? token : null;
}
/** Renewal never revives an expired lease or steals a successor's token. */
export async function renewSourceJob(userId: string, key: string, token: string) {
  const rows = await db().update(sourceJob).set({ expiresAt: new Date(Date.now() + 60_000) })
    .where(and(own(userId, key), eq(sourceJob.token, token), gt(sourceJob.expiresAt, new Date()))).returning({ token: sourceJob.token });
  if (!rows.length) throw new SourceBusyError();
}
export async function releaseSourceJob(userId: string, key: string, token: string) {
  await db().delete(sourceJob).where(and(own(userId, key), eq(sourceJob.token, token)));
}
export async function pendingTranscriptJob(userId: string, key: string) {
  const [r] = await db().select().from(sourceJob).where(own(userId, key));
  return r && r.expiresAt > new Date() ? r : null;
}
export async function saveTranscriptJob(userId: string, key: string, token: string, jobId: string) {
  await db().update(sourceJob).set({ value: { jobId }, expiresAt: new Date(Date.now() + 24 * 3600_000) }).where(and(own(userId, key), eq(sourceJob.token, token)));
}

export async function latestSource(userId: string, sourceKey: string) {
  const [row] = await db().select().from(sourceSnapshot).where(and(eq(sourceSnapshot.userId, userId), eq(sourceSnapshot.sourceKey, sourceKey))).orderBy(desc(sourceSnapshot.fetchedAt), desc(sourceSnapshot.id)).limit(1);
  return row ?? null;
}

export async function sourceById(userId: string, id: string) {
  const [row] = await db().select().from(sourceSnapshot).where(and(eq(sourceSnapshot.userId, userId), eq(sourceSnapshot.id, id)));
  return row ?? null;
}

/** Appends only inside the source lease. The short transaction fences a worker whose lease expired. */
export async function appendSource(userId: string, input: unknown, checkedBy: string, token: string, metadata: SourceMetadata = {}) {
  const data = sourceVersionInput.parse(input);
  return db().transaction(async tx => {
    const [lease] = await tx.select().from(sourceJob).where(and(own(userId, `source:${data.sourceKey}`), eq(sourceJob.token, token))).for("update");
    if (!lease || lease.expiresAt <= new Date()) throw new SourceBusyError();
    const [latest] = await tx.select().from(sourceSnapshot).where(and(eq(sourceSnapshot.userId, userId), eq(sourceSnapshot.sourceKey, data.sourceKey))).orderBy(desc(sourceSnapshot.fetchedAt), desc(sourceSnapshot.id)).limit(1);
    if (latest && metadata.kind === "video-description" && (latest.metadata.kind === "transcript" || latest.metadata.captions)) throw new Error("A video description cannot replace its saved transcript.");
    if (latest && metadata.truncated && !latest.metadata.truncated) throw new Error("Only an excerpt was returned. The previous full source was kept.");
    const hash = sourceHash(data.text);
    if (latest?.contentHash === hash) {
      const nextMetadata = { ...latest.metadata, ...metadata };
      if (metadata.kind === "transcript" && metadata.truncated === false) delete nextMetadata.excerptWindow;
      const [updated] = await tx.update(sourceSnapshot).set({ lastCheckedAt: new Date(), metadata: nextMetadata }).where(eq(sourceSnapshot.id, latest.id)).returning();
      return { snapshot: updated, changed: false };
    }
    const [snapshot] = await tx.insert(sourceSnapshot).values({ ...data, userId, id: randomUUID(), contentHash: hash, checkedBy, metadata, fetchedAt: new Date(Math.max(Date.now(), (latest?.fetchedAt.getTime() ?? 0) + 1)) }).returning();
    return { snapshot, changed: !!latest };
  });
}

export async function captureSource(userId: string, input: unknown, metadata: SourceMetadata = {}) {
  const data = sourceVersionInput.parse(input);
  const key = `source:${data.sourceKey}`;
  const token = await claimSourceJob(userId, key);
  if (!token) throw new SourceBusyError();
  try { return (await appendSource(userId, data, "queue-pilot", token, metadata)).snapshot; }
  finally { await releaseSourceJob(userId, key, token); }
}

export async function recordEvidence(userId: string, postId: string, draftText: string, snapshotId: string, inputs: EvidenceInput[]) {
  const snapshot = await sourceById(userId, snapshotId);
  if (!snapshot) throw new Error("The source is not in this account.");
  const rows = inputs.map(input => ({ userId, bufferPostId: postId, snapshotId, draftText, ...verifyEvidence(draftText, snapshot.text, input, snapshot.metadata) }));
  if (rows.length) await db().insert(draftEvidence).values(rows).onConflictDoNothing();
}

export async function evidenceForPosts(userId: string, ids: string[]) {
  if (!ids.length) return [];
  return db().select().from(draftEvidence).where(and(eq(draftEvidence.userId, userId), inArray(draftEvidence.bufferPostId, ids)));
}

/** Repair only an existing citation on this account's draft. Other sources stay attached.
 * The caller checks current Buffer ownership/status/text. Evidence retains that exact text,
 * so a concurrent Buffer edit makes it stale instead of inheriting this validation.
 */
export async function replaceDraftEvidence(userId: string, postId: string, draftText: string, snapshotId: string, inputs: EvidenceInput[]) {
  if (!inputs.length || inputs.length > 8) throw new Error("Supply between one and eight evidence entries.");
  const source = await sourceById(userId, snapshotId);
  if (!source) throw new Error("The source is not in this account.");
  const key = `source:${source.sourceKey}`;
  const token = await claimSourceJob(userId, key);
  if (!token) throw new SourceBusyError();
  try { await db().transaction(async tx => {
    const [lease] = await tx.select().from(sourceJob).where(and(own(userId, key), eq(sourceJob.token, token))).for("update");
    if (!lease || lease.expiresAt <= new Date()) throw new SourceBusyError();
    const where = and(eq(draftEvidence.userId, userId), eq(draftEvidence.bufferPostId, postId), eq(draftEvidence.snapshotId, snapshotId));
    const existing = await tx.select().from(draftEvidence).where(where).for("update");
    if (!existing.length) throw new Error("That source is not attached to this draft in this account.");
    const [snapshot] = await tx.select().from(sourceSnapshot).where(and(eq(sourceSnapshot.userId, userId), eq(sourceSnapshot.id, snapshotId)));
    if (!snapshot) throw new Error("The source is not in this account.");
    const [latest] = await tx.select().from(sourceSnapshot).where(and(eq(sourceSnapshot.userId, userId), eq(sourceSnapshot.sourceKey, snapshot.sourceKey))).orderBy(desc(sourceSnapshot.fetchedAt), desc(sourceSnapshot.id)).limit(1);
    if (latest?.id !== snapshotId || snapshot.metadata.truncated) throw new Error("This source is outdated or incomplete. Check its current version before repairing evidence.");
    // Quote repair must not erase a current finding that the source contradicts this draft.
    const failedCheck = existing.find(e => e.judgment?.snapshotId === snapshotId && e.judgment.draftText === draftText && !e.judgment.holds)?.judgment;
    const rows = inputs.map(input => {
      const problem = evidenceProblem(draftText, snapshot.text, input, snapshot.metadata);
      if (problem) throw new Error(problem);
      return { userId, bufferPostId: postId, snapshotId, draftText, ...verifyEvidence(draftText, snapshot.text, input, snapshot.metadata), ...(failedCheck ? { judgment: failedCheck } : {}) };
    });
    await tx.delete(draftEvidence).where(where);
    await tx.insert(draftEvidence).values(rows).onConflictDoNothing();
  }); } finally { await releaseSourceJob(userId, key, token); }
}
export async function evidenceForSource(userId: string, sourceKey: string) {
  return db().select({ evidence: draftEvidence, snapshot: sourceSnapshot }).from(draftEvidence)
    .innerJoin(sourceSnapshot, and(eq(sourceSnapshot.id, draftEvidence.snapshotId), eq(sourceSnapshot.userId, draftEvidence.userId)))
    .where(and(eq(draftEvidence.userId, userId), eq(sourceSnapshot.sourceKey, sourceKey)));
}

export async function saveSourceJudgment(userId: string, key: string, token: string, evidence: DraftEvidence, judgment: NonNullable<DraftEvidence["judgment"]>) {
  await db().transaction(async tx => {
    const [lease] = await tx.select().from(sourceJob).where(and(own(userId, `source:${key}`), eq(sourceJob.token, token))).for("update");
    if (!lease || lease.expiresAt <= new Date()) throw new SourceBusyError();
    await tx.update(draftEvidence).set({ judgment }).where(and(eq(draftEvidence.userId, userId), eq(draftEvidence.bufferPostId, evidence.bufferPostId), eq(draftEvidence.snapshotId, evidence.snapshotId), eq(draftEvidence.claim, evidence.claim)));
  });
}

/** The original evidence is current until text or source changes. Missing quotes always need a check. */
export function evidenceNeedsCheck(e: DraftEvidence, latest: SourceSnapshot, draftText: string) {
  const j = e.judgment;
  if (j?.snapshotId === latest.id && j.draftText === draftText) return !j.holds;
  return e.snapshotId !== latest.id || e.draftText !== draftText || !e.quote;
}
export async function sourceHoldsForPosts(userId: string, posts: { id: string; text: string }[]) {
  const rows = await evidenceForPosts(userId, posts.map(p => p.id));
  const snapshots = await Promise.all([...new Set(rows.map(r => r.snapshotId))].map(id => sourceById(userId, id)));
  const keys = [...new Set(snapshots.flatMap(s => s ? [s.sourceKey] : []))];
  const currentSources = await Promise.all(keys.map(key => latestSource(userId, key)));
  const latest = new Map(currentSources.flatMap(s => s ? [[s.sourceKey, s] as const] : []));
  const blocked = new Map<string, string>();
  for (const row of rows) {
    const original = snapshots.find(s => s?.id === row.snapshotId);
    const current = original && latest.get(original.sourceKey);
    const post = posts.find(p => p.id === row.bufferPostId);
    if (post && (!current || evidenceNeedsCheck(row, current, post.text))) blocked.set(post.id, row.judgment?.snapshotId === current?.id && row.judgment?.draftText === post.text ? row.judgment.why : "The source or draft changed. Check its evidence before approving.");
  }
  return blocked;
}
