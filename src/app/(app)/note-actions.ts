"use server";

/**
 * @fileoverview The draft window's team notes: Buffer's own collaboration Notes on a post in the signed-in person's
 * queue. Read, add, edit and delete, always as the person themselves, with Buffer re-checking each permission.
 * A note is never touched unless its post is in this person's queue and the note sits on that post.
 *
 * Mentions: the window offers the teammates Buffer says can read notes on the post's channel. A picked teammate is
 * sent only while their @Name is still in the text, and Buffer checks each mention again on save, refusing the whole
 * note when one cannot see the post.
 */
import { bufferForReading } from "@/lib/current-user";
import { carryMentions, createPostNote, deletePostNote, listPostNotes, MAX_NOTE, mentionSpan, NotesNotAllowedError, placeMentions, updatePostNote, type BufferNote, type MentionAnnotation, type NoteMention, type NoteRefusal, type WantedMention } from "@/lib/buffer/notes";
import { findTeamMembers, listTeamMembers, type TeamMember } from "@/lib/buffer/workspace";
import type { NoteTeammate } from "@/lib/note-mention-picker";
import { limit } from "@/lib/rate-limit";
import { recordAction } from "@/lib/security-events";

/** One @mention in a note: who, and the name written after the @. */
export type DraftMention = { urn: string; name: string };

/** One team note as the draft window shows it. */
export type DraftNote = { id: string; author: string | null; avatar: string | null; createdAt: string; edited: boolean; text: string; /** Who is @mentioned in the text; preview notes may leave it out. */ mentions?: DraftMention[]; canEdit: boolean; canDelete: boolean };
type Result<T> = ({ ok: true } & T) | { ok: false; message: string };

const toDraftNote = (n: BufferNote): DraftNote => ({ id: n.id, author: n.author, avatar: n.avatar, createdAt: n.createdAt, edited: n.updatedAt > n.createdAt, text: n.text, mentions: n.mentions.map((m) => ({ urn: m.urn, name: m.displayValue })), canEdit: n.allowedActions.includes("updateNote"), canDelete: n.allowedActions.includes("deleteNote") });
const FAILED = "Buffer did not answer. Try again in a minute.";
const CANNOT_SEE = "A teammate you mentioned can't see this post, so the note was not sent. Remove that mention and send it again.";
const REFUSED_MENTION = "Buffer did not save the note: a teammate you mentioned can't see this post. Remove that mention and send it again.";

/** The person's Buffer access for one post in their own queue, or why not. */
async function forPost(postId: unknown): Promise<{ ok: true; token: string; userId: string; channelId: string; team: boolean } | { ok: false; message: string }> {
  if (typeof postId !== "string" || !postId || postId.length > 200) return { ok: false, message: "No such post." };
  const b = await bufferForReading();
  if (!b) return { ok: false, message: "Sign in with Buffer first." };
  const post = b.posts.find((p) => p.id === postId);
  if (!post) return { ok: false, message: "This post is not in your queue." };
  // A team is an organization with more than one person; notes are worded for a team only then.
  const org = b.channels.find((c) => c.id === post.channelId)?.organizationId;
  return { ok: true, token: b.token, userId: b.userId, channelId: post.channelId, team: !!org && (b.teamSizes[org] ?? 1) > 1 };
}

/** Turns a failure into words for the person; a missing Notes permission says to sign in again. */
function failure(e: unknown, event: string): { ok: false; message: string } {
  if (e instanceof NotesNotAllowedError) return { ok: false, message: e.message };
  console.error(JSON.stringify({ event, message: e instanceof Error ? e.message : String(e) }));
  return { ok: false, message: FAILED };
}

/** Buffer's refusal in the person's words; an invalid note that carried mentions is Buffer refusing a mention. */
function refused(r: NoteRefusal, mentioned: boolean): { ok: false; message: string } {
  if (r.kind === "closed") return { ok: false, message: "This post's notes are closed in Buffer." };
  if (r.kind === "limit") return { ok: false, message: "Buffer's note limit is reached for this post." };
  return { ok: false, message: r.kind === "invalid" && mentioned ? REFUSED_MENTION : r.message };
}

const toTeammate = (m: TeamMember): NoteTeammate => ({ urn: m.urn, name: mentionSpan(m).slice(1), email: m.email, avatar: m.avatar || null, locked: m.isLocked });

/**
 * The annotations for the picked teammates, each placed where its @Name is in the text. A teammate already mentioned
 * in the saved note keeps that name; a new one must be someone who can read notes on the post's channel. A picked
 * teammate whose name is no longer in the text is left out.
 */
async function pickedMentions(token: string, channelId: string, text: string, urns: unknown, saved: NoteMention[]): Promise<{ ok: true; annotations: MentionAnnotation[] } | { ok: false; message: string }> {
  if (!Array.isArray(urns) || urns.length > 20 || urns.some((u) => typeof u !== "string" || !u || u.length > 200)) return { ok: false, message: "Pick each teammate again." };
  const wanted: WantedMention[] = [];
  const picked = [...new Set(urns as string[])];
  const fresh = picked.filter((urn) => !saved.some((m) => m.urn === urn));
  // Only the newly picked people are looked up, page by page until found, so a teammate past the first pages counts.
  const members = fresh.length ? await findTeamMembers(token, { channelId }, fresh, undefined, undefined, "urn") : [];
  for (const urn of picked) {
    const kept = saved.filter((m) => m.urn === urn);
    if (kept.length) { wanted.push(...kept.map((m) => ({ span: m.text, urn, displayValue: m.displayValue }))); continue; }
    const member = members.find((m) => m.urn === urn);
    if (!member) return { ok: false, message: CANNOT_SEE };
    const span = mentionSpan(member);
    wanted.push({ span, urn, displayValue: span.slice(1) });
  }
  return { ok: true, annotations: placeMentions(text, wanted).annotations };
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

/**
 * The teammates who can read notes on this post's channel, for the @mention picker. Locked members come back marked.
 *
 * @param search - Part of a name or email, when the whole list is longer than one read
 */
export async function listNoteTeammates(postId: string, search?: string): Promise<Result<{ teammates: NoteTeammate[]; more: boolean }>> {
  if (search !== undefined && (typeof search !== "string" || search.length > 100)) return { ok: false, message: "Search for a shorter name." };
  try {
    const p = await forPost(postId);
    if (!p.ok) return p;
    const r = await listTeamMembers(p.token, { channelId: p.channelId }, { search });
    return { ok: true, more: r.more, teammates: r.items.map(toTeammate) };
  } catch (e) {
    return failure(e, "qp-list-teammates-failed");
  }
}

/**
 * Adds a note to a post in the person's queue. Not retried: Buffer may already have saved it.
 *
 * @param mentionUrns - The teammates picked with "@"; each is mentioned where their @Name is in the text
 */
export async function addDraftNote(postId: string, text: string, mentionUrns: string[] = []): Promise<Result<{ note: DraftNote }>> {
  if (typeof text !== "string" || !text.trim()) return { ok: false, message: "Write the note first." };
  if (text.length > MAX_NOTE) return { ok: false, message: `Keep it under ${MAX_NOTE.toLocaleString("en-US")} characters.` };
  try {
    const p = await forPost(postId);
    if (!p.ok) return p;
    const l = await limit("bufferWrite", p.userId);
    if (!l.ok) return { ok: false, message: `Too many requests just now. Try again in ${l.resetSeconds} seconds.` };
    const m = await pickedMentions(p.token, p.channelId, text.trim(), mentionUrns, []);
    if (!m.ok) return m;
    const r = await createPostNote(p.token, postId, text.trim(), undefined, m.annotations);
    return r.ok ? { ok: true, note: toDraftNote(r.note) } : refused(r, m.annotations.length > 0);
  } catch (e) {
    const f = failure(e, "qp-add-note-failed");
    return f.message === FAILED ? { ok: false, message: "Buffer did not answer, so the note may be saved. Reopen the post before adding it again." } : f;
  }
}

/** The note, if it sits on this post and Buffer lets this person do `action` with it. */
async function ownNote(token: string, postId: string, noteId: unknown, action: "canEdit" | "canDelete"): Promise<{ ok: true; note: BufferNote } | { ok: false; message: string }> {
  if (typeof noteId !== "string" || !noteId || noteId.length > 200) return { ok: false, message: "No such note." };
  const { notes } = await listPostNotes(token, postId, 100);
  const note = notes.find((n) => n.id === noteId);
  if (!note) return { ok: false, message: "That note is no longer on this post." };
  if (!toDraftNote(note)[action]) return { ok: false, message: "Buffer does not let you change this note." };
  return { ok: true, note };
}

/**
 * Replaces the text of a note the person may edit. Buffer clears every mention an update does not send, so each saved
 * mention whose @Name is still in the new text is sent again at its new place; one whose name was deleted is dropped.
 *
 * @param mentionUrns - The teammates mentioned after the edit (saved ones kept, new ones picked); without it, the
 *   saved mentions still in the text are kept
 */
export async function editDraftNote(postId: string, noteId: string, text: string, mentionUrns?: string[]): Promise<Result<object>> {
  if (typeof text !== "string" || !text.trim()) return { ok: false, message: "Write the note first." };
  if (text.length > MAX_NOTE) return { ok: false, message: `Keep it under ${MAX_NOTE.toLocaleString("en-US")} characters.` };
  try {
    const p = await forPost(postId);
    if (!p.ok) return p;
    const l = await limit("bufferWrite", p.userId);
    if (!l.ok) return { ok: false, message: `Too many requests just now. Try again in ${l.resetSeconds} seconds.` };
    const own = await ownNote(p.token, postId, noteId, "canEdit");
    if (!own.ok) return own;
    const m = mentionUrns === undefined ? { ok: true as const, annotations: carryMentions(own.note.mentions, text.trim()) } : await pickedMentions(p.token, p.channelId, text.trim(), mentionUrns, own.note.mentions);
    if (!m.ok) return m;
    const r = await updatePostNote(p.token, noteId, text.trim(), undefined, m.annotations);
    return r.ok ? { ok: true } : refused(r, m.annotations.length > 0);
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
    if (!r.ok) return { ok: false, message: r.message };
    // Same record a connected AI app's delete leaves, so Security activity lists every deleted note.
    await recordAction(p.userId, "note_deleted", { via: "app" }, { ids: [noteId] });
    return { ok: true };
  } catch (e) {
    return failure(e, "qp-delete-note-failed");
  }
}
