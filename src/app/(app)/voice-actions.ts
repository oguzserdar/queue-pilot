"use server";

import { revalidatePath } from "next/cache";
import { signedInUserId } from "@/lib/current-user";
import { addPastedExample, exampleFromQueue, InvalidVoiceExampleError, MAX_NOTE, postgresVoiceStore, TooManyExamplesError } from "@/lib/voice-store";
import { postgresSnapshotStore } from "@/lib/buffer/snapshot-store";
import type { SourceActionResult } from "./actions";

/** Picks one of the user's own sent posts as a voice example. The text is read from their saved queue, never from the browser. */
export async function addVoiceExample(postId: string): Promise<SourceActionResult> {
  const userId = await signedInUserId();
  if (!userId) return { ok: false, message: "Sign in with Buffer first." };
  if (typeof postId !== "string" || postId.length > 200) return { ok: false, message: "Unknown post." };
  try {
    const snap = await postgresSnapshotStore().get(userId);
    const example = snap ? exampleFromQueue(snap.data, postId) : null;
    if (!example) return { ok: false, message: "That post is not in your recent sent posts." };
    await postgresVoiceStore().addExample(userId, example);
  } catch (e) {
    if (e instanceof TooManyExamplesError) return { ok: false, message: e.message };
    console.error(JSON.stringify({ event: "qp-voice-add-failed", message: e instanceof Error ? e.message : String(e) }));
    return { ok: false, message: "Queue Pilot could not save that just now. Try again in a minute." };
  }
  revalidatePath("/voice");
  return { ok: true };
}

/** Saves a post the signed-in person pasted to teach their writing style. */
export async function addPastedVoiceExample(text: string): Promise<SourceActionResult> {
  const userId = await signedInUserId()
  if (!userId) return { ok: false, message: "Sign in with Buffer first." }
  try {
    await addPastedExample(postgresVoiceStore(), userId, text)
  } catch (e) {
    if (e instanceof TooManyExamplesError || e instanceof InvalidVoiceExampleError) return { ok: false, message: e.message }
    console.error(JSON.stringify({ event: "qp-voice-paste-failed", message: e instanceof Error ? e.message : String(e) }))
    return { ok: false, message: "Could not save that just now. Try again in a minute." }
  }
  revalidatePath("/voice")
  return { ok: true }
}

/** Stops using one post as a voice example. */
export async function removeVoiceExample(postId: string): Promise<SourceActionResult> {
  const userId = await signedInUserId();
  if (!userId) return { ok: false, message: "Sign in with Buffer first." };
  if (typeof postId !== "string" || postId.length > 200) return { ok: false, message: "Unknown post." };
  try {
    await postgresVoiceStore().removeExample(userId, postId);
  } catch (e) {
    console.error(JSON.stringify({ event: "qp-voice-remove-failed", message: e instanceof Error ? e.message : String(e) }));
    return { ok: false, message: "Queue Pilot could not remove that just now. Try again in a minute." };
  }
  revalidatePath("/voice");
  return { ok: true };
}

/** Saves the user's note on how they write; an empty note clears it. */
export async function saveVoiceNote(note: string): Promise<SourceActionResult> {
  const userId = await signedInUserId();
  if (!userId) return { ok: false, message: "Sign in with Buffer first." };
  if (typeof note !== "string" || note.length > MAX_NOTE) return { ok: false, message: `Keep the note to ${MAX_NOTE} characters.` }
  try {
    await postgresVoiceStore().setNote(userId, note);
  } catch (e) {
    console.error(JSON.stringify({ event: "qp-voice-note-failed", message: e instanceof Error ? e.message : String(e) }));
    return { ok: false, message: "Queue Pilot could not save your note just now. Try again in a minute." };
  }
  revalidatePath("/voice");
  return { ok: true };
}
