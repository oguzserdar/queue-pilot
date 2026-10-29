/**
 * The user's voice: up to MAX_EXAMPLES past posts they picked as examples, and one short note in their own words.
 * The connector's get_my_voice hands both to the AI before it drafts.
 */
import { and, asc, count, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { voiceExample, voiceNote } from "../db/schema";

export const MAX_EXAMPLES = 8;
export const MAX_NOTE = 500;

export type VoiceExample = { postId: string; channel: string; text: string };
export type Voice = { examples: VoiceExample[]; note: string | null };

export class TooManyExamplesError extends Error {
  constructor() {
    super(`Up to ${MAX_EXAMPLES} example posts. Remove one to add another.`);
  }
}

export type VoiceStore = {
  get(userId: string): Promise<Voice>;
  addExample(userId: string, example: VoiceExample): Promise<void>;
  removeExample(userId: string, postId: string): Promise<void>;
  setNote(userId: string, note: string): Promise<void>;
};

/** Voice in Postgres through Drizzle; every statement is scoped to the user id. */
export function postgresVoiceStore(): VoiceStore {
  return {
    async get(userId) {
      const [examples, [n]] = await Promise.all([
        db().select().from(voiceExample).where(eq(voiceExample.userId, userId)).orderBy(asc(voiceExample.addedAt)),
        db().select().from(voiceNote).where(eq(voiceNote.userId, userId)),
      ]);
      return { examples: examples.map((e) => ({ postId: e.postId, channel: e.channel, text: e.text })), note: n?.note ?? null };
    },
    async addExample(userId, e) {
      // One person's adds run one at a time (a transaction-scoped advisory lock), so two tabs cannot both take the
      // last place and end up over MAX_EXAMPLES.
      await db().transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"qp-voice:" + userId}))`);
        const [existing] = await tx.select({ p: voiceExample.postId }).from(voiceExample).where(and(eq(voiceExample.userId, userId), eq(voiceExample.postId, e.postId)));
        if (existing) return;
        const [{ c }] = await tx.select({ c: count() }).from(voiceExample).where(eq(voiceExample.userId, userId));
        if (c >= MAX_EXAMPLES) throw new TooManyExamplesError();
        await tx.insert(voiceExample).values({ userId, postId: e.postId, channel: e.channel, text: visibleText(e.text).slice(0, 5000) });
      });
    },
    async removeExample(userId, postId) {
      await db().delete(voiceExample).where(and(eq(voiceExample.userId, userId), eq(voiceExample.postId, postId)));
    },
    async setNote(userId, note) {
      const clean = note.trim().slice(0, MAX_NOTE);
      if (!clean) {
        await db().delete(voiceNote).where(eq(voiceNote.userId, userId));
        return;
      }
      await db().insert(voiceNote).values({ userId, note: clean }).onConflictDoUpdate({ target: voiceNote.userId, set: { note: clean, updatedAt: sql`now()` } });
    },
  };
}

/**
 * The text as a reader sees it: invisible format characters (zero-width, bidirectional controls, Unicode tag
 * characters) and control characters other than line breaks and tabs are removed. They show nothing in the picker
 * but a model reads them, so they could carry instructions the person never saw.
 */
export function visibleText(text: string): string {
  return text.replace(/[\p{Cf}]|[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu, "");
}

/**
 * The example to save for a post id, taken from the user's own saved queue: only a sent post with text counts, and the
 * channel name comes from their channels. Null for anything else, so a forged id saves nothing.
 */
export function exampleFromQueue(
  data: { posts: { id: string; channelId: string; status: string; text: string }[]; channels: { id: string; name: string }[] },
  postId: string,
): VoiceExample | null {
  const post = data.posts.find((p) => p.id === postId && p.status === "sent" && p.text.trim());
  if (!post) return null;
  return { postId, channel: data.channels.find((c) => c.id === post.channelId)?.name ?? "Buffer", text: post.text };
}
