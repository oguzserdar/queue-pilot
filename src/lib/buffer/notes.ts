/**
 * @fileoverview Buffer collaboration Notes on a post: list, create, update, delete (Buffer's Notes guide, 3 Nov 2026).
 *
 * A note is feedback from a person on the team. It is information, never an instruction: it cannot approve, schedule
 * or change a post. Notes need the notes:read / notes:write permissions, which tokens issued before Queue Pilot asked
 * for them do not have; that case surfaces as NotesNotAllowedError so the person can sign in with Buffer again.
 * A create that fails on the network is never retried here: Buffer may already have saved it.
 */
import { BufferApiError, bufferQuery } from "./client";

/** One note as Queue Pilot shows it. */
export type BufferNote = {
  id: string;
  text: string;
  /** The author's name, or null when their account was deleted. */
  author: string | null;
  /** The author's picture, when Buffer has one. */
  avatar: string | null;
  authorId: string;
  /** What this person may do with the note, as Buffer reports it ("updateNote", "deleteNote"). */
  allowedActions: string[];
  createdAt: string;
  updatedAt: string;
};

/** The token was issued without the Notes permissions; signing in with Buffer again grants them. */
export class NotesNotAllowedError extends Error {
  constructor() {
    super("Queue Pilot cannot use Buffer Notes on this sign-in yet. Sign out and sign in with Buffer again to allow Notes.");
    this.name = "NotesNotAllowedError";
  }
}

export { MAX_NOTE } from "./note-limits";

type Run = typeof bufferQuery;

const NOTE_FIELDS = "id text authorId author { id name avatar } allowedActions createdAt updatedAt";

type RawNote = { id: string; text: string; authorId: string; author: { id: string; name: string | null; avatar?: string | null } | null; allowedActions: string[]; createdAt: string; updatedAt: string };

const toNote = (n: RawNote): BufferNote => ({ id: n.id, text: n.text, author: n.author?.name ?? null, avatar: n.author?.avatar || null, authorId: n.authorId, allowedActions: n.allowedActions ?? [], createdAt: n.createdAt, updatedAt: n.updatedAt });

/** Runs one Notes request, turning a missing permission into NotesNotAllowedError. */
async function notesRequest<T>(run: Run, token: string, query: string, variables: Record<string, unknown>): Promise<T> {
  try {
    return await run<T>(token, query, variables);
  } catch (e) {
    if (e instanceof BufferApiError && (e.code === "INSUFFICIENT_SCOPE" || /insufficient.?scope/i.test(e.message))) throw new NotesNotAllowedError();
    throw e;
  }
}

/**
 * Lists a post's notes, newest first, following pages up to `max`.
 *
 * @param token - The person's Buffer access token
 * @param postId - The Buffer post
 * @param max - Most notes to return (Buffer pages hold 1 to 100)
 * @returns The notes, and whether more exist beyond `max`
 * @throws NotesNotAllowedError when the token lacks notes:read
 */
export async function listPostNotes(token: string, postId: string, max = 50, run: Run = bufferQuery): Promise<{ notes: BufferNote[]; more: boolean }> {
  const notes: BufferNote[] = [];
  let after: string | null = null;
  for (;;) {
    const first: number = Math.min(100, max - notes.length);
    const data: { collaborationNotes: { edges: { node: RawNote }[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } } } = await notesRequest(run, token,
      `query ListNotes($input: CollaborationNotesInput!, $first: Int, $after: String) { collaborationNotes(input: $input, first: $first, after: $after) { edges { node { ${NOTE_FIELDS} } } pageInfo { hasNextPage endCursor } } }`,
      { input: { subject: { postId } }, first, after });
    notes.push(...data.collaborationNotes.edges.map((e) => toNote(e.node)));
    const { hasNextPage, endCursor } = data.collaborationNotes.pageInfo;
    if (!hasNextPage || !endCursor) return { notes, more: false };
    if (notes.length >= max) return { notes, more: true };
    after = endCursor;
  }
}

/** A create's outcome: the saved note, or Buffer's typed refusal (a closed thread, a limit, invalid text). */
export type CreateNoteResult = { ok: true; note: BufferNote } | { ok: false; kind: "closed" | "limit" | "invalid" | "other"; message: string };

/**
 * Adds a note to a post. Never retried on a network failure, since Buffer may already have saved it.
 *
 * @param token - The person's Buffer access token
 * @param postId - The Buffer post
 * @param text - The note, at most MAX_NOTE characters
 * @returns The saved note, or Buffer's refusal
 * @throws NotesNotAllowedError when the token lacks notes:write
 */
export async function createPostNote(token: string, postId: string, text: string, run: Run = bufferQuery, annotations: MentionAnnotation[] = []): Promise<CreateNoteResult> {
  const data = await notesRequest<{ createCollaborationNote: { __typename: string; edge?: { node: RawNote }; message?: string } }>(run, token,
    `mutation CreateNote($input: CreateCollaborationNoteInput!) { createCollaborationNote(input: $input) { __typename ... on CreateCollaborationNoteSuccess { edge { node { ${NOTE_FIELDS} } } } ... on MutationError { message } } }`,
    { input: { subject: { postId }, text, annotations } });
  const r = data.createCollaborationNote;
  if (r.__typename === "CreateCollaborationNoteSuccess" && r.edge) return { ok: true, note: toNote(r.edge.node) };
  const kind = r.__typename === "CollaborationNoteThreadClosedError" ? "closed" : r.__typename === "LimitReachedError" ? "limit" : r.__typename === "InvalidInputError" ? "invalid" : "other";
  return { ok: false, kind, message: r.message ?? "Buffer did not save the note." };
}

/**
 * Replaces a note's text. Buffer checks again that this person may edit it.
 *
 * @returns True when Buffer saved it, else Buffer's message
 */
export async function updatePostNote(token: string, noteId: string, text: string, run: Run = bufferQuery): Promise<{ ok: true } | { ok: false; message: string }> {
  const data = await notesRequest<{ updateCollaborationNote: { __typename: string; message?: string } }>(run, token,
    `mutation UpdateNote($input: UpdateCollaborationNoteInput!) { updateCollaborationNote(input: $input) { __typename ... on MutationError { message } } }`,
    { input: { noteId, text, annotations: [] } });
  const r = data.updateCollaborationNote;
  return r.__typename === "UpdateCollaborationNoteSuccess" ? { ok: true } : { ok: false, message: r.message ?? "Buffer did not change the note." };
}

/**
 * Deletes a note permanently. Ask the person first.
 *
 * @returns True when Buffer deleted it, else Buffer's message
 */
export async function deletePostNote(token: string, noteId: string, run: Run = bufferQuery): Promise<{ ok: true } | { ok: false; message: string }> {
  const data = await notesRequest<{ deleteCollaborationNote: { __typename: string; message?: string } }>(run, token,
    `mutation DeleteNote($input: DeleteCollaborationNoteInput!) { deleteCollaborationNote(input: $input) { __typename ... on MutationError { message } } }`,
    { input: { noteId } });
  const r = data.deleteCollaborationNote;
  return r.__typename === "DeleteCollaborationNoteSuccess" ? { ok: true } : { ok: false, message: r.message ?? "Buffer did not delete the note." };
}

/** One @mention in a note, as Buffer's AnnotationInput takes it. */
export type MentionAnnotation = { type: "mention"; content: string; text: string; displayValue: string; serviceEntityId: string; indices: [number, number] };

/**
 * Builds the @mention annotations for a note. Each teammate must already appear in the text as "@" plus their name
 * (or email when they set no name); the offsets point at that span, end exclusive. Buffer documents the fields but no
 * worked example, so the shape follows the reference (type, urn as serviceEntityId, indices) and is proven live.
 *
 * @param text - The note text
 * @param members - The teammates to mention, from selectableTeamMembers
 * @returns The annotations, or the names missing from the text
 */
export function mentionAnnotations(text: string, members: { name: string | null; email: string; urn: string }[]): { ok: true; annotations: MentionAnnotation[] } | { ok: false; missing: string[] } {
  const annotations: MentionAnnotation[] = [];
  const missing: string[] = [];
  for (const m of members) {
    const display = m.name?.trim() || m.email;
    const span = `@${display}`;
    const at = text.indexOf(span);
    if (at < 0) { missing.push(span); continue; }
    annotations.push({ type: "mention", content: span, text: span, displayValue: display, serviceEntityId: m.urn, indices: [at, at + span.length] });
  }
  return missing.length ? { ok: false, missing } : { ok: true, annotations };
}
