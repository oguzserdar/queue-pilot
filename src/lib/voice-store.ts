/**
 * The user's voice: up to MAX_EXAMPLES past posts they picked as examples, and one short note in their own words.
 * The connector's get_my_voice hands both to the AI before it drafts.
 */
import { and, asc, count, eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto"
import { db } from "../db";
import { voiceExample, voiceNote } from "../db/schema";

import { MAX_EXAMPLES, MAX_NOTE, MAX_PASTED_TEXT } from "./voice-limits"
export { MAX_EXAMPLES, MAX_NOTE, MAX_PASTED_TEXT } from "./voice-limits"

/** One post the user chose to teach their writing style. */
export type VoiceExample = { postId: string; channel: string; text: string };
/** The user's writing examples and note. */
export type Voice = { examples: VoiceExample[]; note: string | null };

/** The user must remove an example before adding another. */
export class TooManyExamplesError extends Error {
  constructor() {
    super(`Up to ${MAX_EXAMPLES} example posts. Remove one to add another.`);
  }
}

/** Voice reads and writes scoped to one person. */
export type VoiceStore = {
  get(userId: string): Promise<Voice>;
  addExample(userId: string, example: VoiceExample): Promise<void>;
  removeExample(userId: string, postId: string): Promise<void>;
  setNote(userId: string, note: string): Promise<void>;
};

/** A pasted post failed the shared input checks. */
export class InvalidVoiceExampleError extends Error {}

/** Saves visible writing without requiring a past Buffer post. */
export async function addPastedExample(store: VoiceStore, userId: string, text: string): Promise<void> {
  if (typeof text !== "string" || text.length > MAX_PASTED_TEXT)
    throw new InvalidVoiceExampleError(`Use up to ${MAX_PASTED_TEXT} characters for an example.`)
  const clean = visibleText(text).trim()
  if (!clean) throw new InvalidVoiceExampleError("Paste a post you wrote first.")
  await store.addExample(userId, { postId: `pasted:${randomUUID()}`, channel: "Pasted", text: clean })
}

/** A private voice store for tests, with the same example limit. */
export function memoryVoiceStore(): VoiceStore {
  const voices = new Map<string, Voice>()
  const get = (userId: string) => voices.get(userId) ?? { note: null, examples: [] }
  return {
    async get(userId) { return structuredClone(get(userId)) },
    async addExample(userId, example) {
      const voice = get(userId)
      if (voice.examples.some((e) => e.postId === example.postId)) return
      if (voice.examples.length >= MAX_EXAMPLES) throw new TooManyExamplesError()
      voices.set(userId, { ...voice, examples: [...voice.examples, { ...example, text: visibleText(example.text).slice(0, 5000) }] })
    },
    async removeExample(userId, postId) {
      const voice = get(userId)
      voices.set(userId, { ...voice, examples: voice.examples.filter((e) => e.postId !== postId) })
    },
    async setNote(userId, note) {
      voices.set(userId, { ...get(userId), note: note.trim().slice(0, MAX_NOTE) || null })
    },
  }
}

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
