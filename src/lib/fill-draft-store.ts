/**
 * @fileoverview The in-app writer's own record of the drafts it wrote, kept before they reach Buffer.
 *
 * A draft is recorded here the moment the model finishes it, then the whole run is saved to Buffer in one go and each
 * row is marked with what happened. A row still "written" after a run is a draft Buffer may or may not hold; the
 * posting time in its slot id is what recovery checks, so a retry never makes a second draft for one time.
 */
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import { fillDraft } from "../db/schema";
import type { WrittenDraft } from "./ai-writer";

export type FillDraftStore = {
  /** Records a draft the model just finished. A rewrite for the same time in the same run replaces it. */
  written(userId: string, runId: string, draft: WrittenDraft): Promise<void>;
  /** Marks that the Buffer save for these times is starting, so an answer that never comes back is told apart from a save never tried. */
  startCall(userId: string, runId: string, slotIds: string[]): Promise<void>;
  /** Records what the Buffer save did with each time. */
  finish(userId: string, runId: string, outcome: { saved: { slotId: string; postId: string | null }[]; refused: { slotId: string; reason: string }[] }): Promise<void>;
};

/** The record in Postgres through Drizzle; every statement is scoped to the user id. */
export function postgresFillDraftStore(): FillDraftStore {
  return {
    async written(userId, runId, d) {
      const row = { text: d.text, sourceKey: d.sourceKey ?? null, snapshotId: d.snapshotId ?? null, evidence: d.evidence ?? null, status: "written" as const, reason: null, postId: null, callStartedAt: null, updatedAt: new Date() };
      await db().insert(fillDraft).values({ userId, runId, slotId: d.slotId, ...row }).onConflictDoUpdate({ target: [fillDraft.userId, fillDraft.runId, fillDraft.slotId], set: row });
    },
    async startCall(userId, runId, slotIds) {
      if (!slotIds.length) return;
      await db().update(fillDraft).set({ callStartedAt: new Date(), updatedAt: new Date() }).where(and(eq(fillDraft.userId, userId), eq(fillDraft.runId, runId), inArray(fillDraft.slotId, slotIds)));
    },
    async finish(userId, runId, { saved, refused }) {
      const at = (slotId: string) => and(eq(fillDraft.userId, userId), eq(fillDraft.runId, runId), eq(fillDraft.slotId, slotId));
      for (const s of saved) await db().update(fillDraft).set({ status: "saved", postId: s.postId, reason: null, updatedAt: new Date() }).where(at(s.slotId));
      for (const r of refused) await db().update(fillDraft).set({ status: "refused", reason: r.reason.slice(0, 500), updatedAt: new Date() }).where(at(r.slotId));
    },
  };
}
