"use server";

/**
 * @fileoverview The signed-in person's Buffer ideas board, read for the New material page: Buffer's columns in
 * Buffer's order, starting with the ideas in no column, as Buffer's own board does. Read only. Each board costs two
 * Buffer requests, so one person's boards are kept for five minutes; concurrent readers share the same fetch.
 */
import { listIdeas, type BufferIdea } from "@/lib/buffer/ideas";
import { bufferForReading } from "@/lib/current-user";

/** One idea card. */
export type IdeaCard = { id: string; title: string | null; text: string | null };
/** One column, in board order; the first is the ideas outside any column. */
export type IdeaColumn = { id: string; name: string; ideas: IdeaCard[] };
/** One organization's board. */
export type IdeaBoard = { organizationId: string; columns: IdeaColumn[]; more: boolean };

const KEEP_MS = 5 * 60_000;
const kept = new Map<string, { promise: Promise<IdeaBoard[]>; expires: number }>();

/** Arranges ideas into Buffer's board: Unassigned first, then each column in Buffer's order. */
export async function toColumns(ideas: BufferIdea[], groups: { id: string; name: string }[]): Promise<IdeaColumn[]> {
  const card = (i: BufferIdea): IdeaCard => ({ id: i.id, title: i.title, text: i.text });
  return [
    { id: "unassigned", name: "Unassigned", ideas: ideas.filter((i) => !i.groupId).map(card) },
    ...groups.map((g) => ({ id: g.id, name: g.name, ideas: ideas.filter((i) => i.groupId === g.id).map(card) })),
  ];
}

/** The person's Buffer ideas, one board per organization they have channels in. */
export async function readIdeaBoards(): Promise<{ ok: true; boards: IdeaBoard[] } | { ok: false; message: string }> {
  const b = await bufferForReading();
  if (!b) return { ok: false, message: "Sign in with Buffer first." };
  const orgs = [...new Set(b.channels.map((c) => c.organizationId).filter((o): o is string => !!o))];
  const now = Date.now();
  const hit = kept.get(b.userId);
  let promise = hit && hit.expires > now ? hit.promise : null;
  if (!promise) {
    promise = Promise.all(orgs.map(async (organizationId) => {
      const { ideas, groups, more } = await listIdeas(b.token, organizationId, 100);
      return { organizationId, columns: await toColumns(ideas, groups), more };
    }));
    const mine = promise;
    kept.set(b.userId, { promise: mine, expires: now + KEEP_MS });
    // A failed read is not kept: the next visit asks Buffer again.
    mine.catch(() => { if (kept.get(b.userId)?.promise === mine) kept.delete(b.userId); });
  }
  try {
    return { ok: true, boards: await promise };
  } catch (e) {
    console.error(JSON.stringify({ event: "qp-read-ideas-failed", message: e instanceof Error ? e.message : String(e) }));
    return { ok: false, message: "Buffer did not return your ideas. Try again in a minute." };
  }
}
