"use server";

/**
 * @fileoverview The draft window's team notes: Buffer's own collaboration Notes on a post in the signed-in person's
 * queue. Read, add, edit and delete, always as the person themselves, with Buffer re-checking each permission.
 * A note is never touched unless its post is in this person's queue and the note sits on that post.
 */
import { bufferForReading } from "@/lib/current-user";
import { createPostNote, deletePostNote, listPostNotes, MAX_NOTE, NotesNotAllowedError, updatePostNote, type BufferNote } from "@/lib/buffer/notes";
import { limit } from "@/lib/rate-limit";

/** One team note as the draft window shows it. */
export type DraftNote = { id: string; author: string | null; avatar: string | null; createdAt: string; edited: boolean; text: string; canEdit: boolean; canDelete: boolean };
type Result<T> = ({ ok: true } & T) | { ok: false; message: string };

const toDraftNote = (n: BufferNote): DraftNote => ({ id: n.id, author: n.author, avatar: n.avatar, createdAt: n.createdAt, edited: n.updatedAt > n.createdAt, text: n.text, canEdit: n.allowedActions.includes("updateNote"), canDelete: n.allowedActions.includes("deleteNote") });
const FAILED = "Buffer did not answer. Try again in a minute.";

/** The person's Buffer access for one post in their own queue, or why not. */
async function forPost(postId: unknown): Promise<{ ok: true; token: string; userId: string; team: boolean } | { ok: false; message: string }> {
  if (typeof postId !== "string" || !postId || postId.length > 200) return { ok: false, message: "No such post." };
  const b = await bufferForReading();
  if (!b) return { ok: false, message: "Sign in with Buffer first." };
  const post = b.posts.find((p) => p.id === postId);
  if (!post) return { ok: false, message: "This post is not in your queue." };
  // A team is an organization with more than one person; notes are worded for a team only then.
  const org = b.channels.find((c) => c.id === post.channelId)?.organizationId;
  return { ok: true, token: b.token, userId: b.userId, team: !!org && (b.teamSizes[org] ?? 1) > 1 };
}

/** Turns a failure into words for the person; a missing Notes permission says to sign in again. */
function failure(e: unknown, event: string): { ok: false; message: string } {
  if (e instanceof NotesNotAllowedError) return { ok: false, message: e.message };
  console.error(JSON.stringify({ event, message: e instanceof Error ? e.message : String(e) }));
  return { ok: false, message: FAILED };
}

/** The Buffer notes on one post in the signed-in person's queue, newest first. */
export async function readDraftNotes(postId: string): Promise<Result<{ notes: DraftNote[]; more: boolean; team: boolean }>> {
  try {
    const p = await forPost(postId);
    if (!p.ok) return p;
    const { notes, more } = await listPostNotes(p.token, postId, 20);
    return { ok: true, more, team: p.team, notes: notes.map(toDraftNote) };
  } catch (e) {
    return failure(e, "qp-read-notes-failed");
  }
}

/** Adds a note to a post in the person's queue. Not retried: Buffer may already have saved it. */
export async function addDraftNote(postId: string, text: string): Promise<Result<{ note: DraftNote }>> {
  if (typeof text !== "string" || !text.trim()) return { ok: false, message: "Write the note first." };
  if (text.length > MAX_NOTE) return { ok: false, message: `Keep it under ${MAX_NOTE.toLocaleString("en-US")} characters.` };
  try {
    const p = await forPost(postId);
    if (!p.ok) return p;
    const l = await limit("bufferWrite", p.userId);
    if (!l.ok) return { ok: false, message: `Too many requests just now. Try again in ${l.resetSeconds} seconds.` };
    const r = await createPostNote(p.token, postId, text.trim());
    if (r.ok) return { ok: true, note: toDraftNote(r.note) };
    return { ok: false, message: r.kind === "closed" ? "This post's notes are closed in Buffer." : r.kind === "limit" ? "Buffer's note limit is reached for this post." : r.message };
  } catch (e) {
    const f = failure(e, "qp-add-note-failed");
    return f.message === FAILED ? { ok: false, message: "Buffer did not answer, so the note may be saved. Reopen the post before adding it again." } : f;
  }
}

/** The note, if it sits on this post and Buffer lets this person do `action` with it. */
async function ownNote(token: string, postId: string, noteId: unknown, action: "canEdit" | "canDelete"): Promise<{ ok: true } | { ok: false; message: string }> {
  if (typeof noteId !== "string" || !noteId || noteId.length > 200) return { ok: false, message: "No such note." };
  const { notes } = await listPostNotes(token, postId, 100);
  const note = notes.find((n) => n.id === noteId);
  if (!note) return { ok: false, message: "That note is no longer on this post." };
  if (!toDraftNote(note)[action]) return { ok: false, message: "Buffer does not let you change this note." };
  return { ok: true };
}

/** Replaces the text of a note the person may edit. */
export async function editDraftNote(postId: string, noteId: string, text: string): Promise<Result<object>> {
  if (typeof text !== "string" || !text.trim()) return { ok: false, message: "Write the note first." };
  if (text.length > MAX_NOTE) return { ok: false, message: `Keep it under ${MAX_NOTE.toLocaleString("en-US")} characters.` };
  try {
    const p = await forPost(postId);
    if (!p.ok) return p;
    const l = await limit("bufferWrite", p.userId);
    if (!l.ok) return { ok: false, message: `Too many requests just now. Try again in ${l.resetSeconds} seconds.` };
    const own = await ownNote(p.token, postId, noteId, "canEdit");
    if (!own.ok) return own;
    const r = await updatePostNote(p.token, noteId, text.trim());
    return r.ok ? { ok: true } : { ok: false, message: r.message };
  } catch (e) {
    return failure(e, "qp-edit-note-failed");
  }
}

/** Deletes a note the person may delete. Permanent; the window asks first. */
export async function deleteDraftNote(postId: string, noteId: string): Promise<Result<object>> {
  try {
    const p = await forPost(postId);
    if (!p.ok) return p;
    const l = await limit("bufferWrite", p.userId);
    if (!l.ok) return { ok: false, message: `Too many requests just now. Try again in ${l.resetSeconds} seconds.` };
    const own = await ownNote(p.token, postId, noteId, "canDelete");
    if (!own.ok) return own;
    const r = await deletePostNote(p.token, noteId);
    return r.ok ? { ok: true } : { ok: false, message: r.message };
  } catch (e) {
    return failure(e, "qp-delete-note-failed");
  }
}
