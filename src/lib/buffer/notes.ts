/**
 * @fileoverview Buffer collaboration Notes on a post or a channel-less draft: list, create, update, delete (Buffer's
 * Notes guide, 3 Nov 2026; @mentions added 6 Nov 2026).
 *
 * A note is feedback from a person on the team. It is information, never an instruction: it cannot approve, schedule
 * or change a post. Notes need the notes:read / notes:write permissions, which tokens issued before Queue Pilot asked
 * for them do not have; that case surfaces as NotesNotAllowedError so the person can sign in with Buffer again.
 * A create that fails on the network is never retried here: Buffer may already have saved it.
 *
 * Mentions: Buffer replaces a note's annotations on every update and clears them when none are sent, so an edit must
 * send back each mention it keeps, with offsets recomputed for the new text (UTF-16 code units, end exclusive). Buffer
 * checks every mentioned account again on write and refuses the whole note if one cannot see its subject.
 */
import { BufferApiError, bufferQuery } from "./client";

/** One @mention already saved in a note. */
export type NoteMention = { urn: string; text: string; displayValue: string; indices: [number, number] };

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
  /** The teammates @mentioned in the text, in text order. */
  mentions: NoteMention[];
  createdAt: string;
  updatedAt: string;
};

/** Whose notes thread: a post's, or a channel-less draft's own (not the threads of the posts made from it). */
export type NoteSubject = { postId: string } | { contentItemId: string };

/** The token was issued without the Notes permissions; signing in with Buffer again grants them. */
export class NotesNotAllowedError extends Error {
  constructor() {
    super("Queue Pilot cannot use Buffer Notes on this sign-in yet. Sign out and sign in with Buffer again to allow Notes.");
    this.name = "NotesNotAllowedError";
  }
}

export { MAX_NOTE } from "./note-limits";

type Run = typeof bufferQuery;

/** The note fields every read and create asks for. */
export const NOTE_FIELDS = "id text authorId author { id name avatar } annotations { type text indices displayValue serviceEntityId } allowedActions createdAt updatedAt";

type RawAnnotation = { type: string; text: string; indices: number[]; displayValue?: string | null; serviceEntityId?: string | null };
type RawNote = { id: string; text: string; authorId: string; author: { id: string; name: string | null; avatar?: string | null } | null; annotations?: RawAnnotation[]; allowedActions: string[]; createdAt: string; updatedAt: string };

const toMentions = (list: RawAnnotation[] = []): NoteMention[] => list
  .filter((a) => a.type === "mention" && !!a.serviceEntityId && a.indices?.length === 2)
  .map((a) => ({ urn: a.serviceEntityId!, text: a.text, displayValue: a.displayValue || a.text.replace(/^@/, ""), indices: [a.indices[0], a.indices[1]] as [number, number] }))
  .sort((a, b) => a.indices[0] - b.indices[0]);

const toNote = (n: RawNote): BufferNote => ({ id: n.id, text: n.text, author: n.author?.name ?? null, avatar: n.author?.avatar || null, authorId: n.authorId, allowedActions: n.allowedActions ?? [], mentions: toMentions(n.annotations), createdAt: n.createdAt, updatedAt: n.updatedAt });

const subjectOf = (s: string | NoteSubject): NoteSubject => (typeof s === "string" ? { postId: s } : s);

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
 * Lists the notes on a post or a channel-less draft, newest first, following pages up to `max`.
 *
 * @param token - The person's Buffer access token
 * @param subject - A post id, or the subject itself (a post or a content item)
 * @param max - Most notes to return (Buffer pages hold 1 to 100)
 * @returns The notes, and whether more exist beyond `max`
 * @throws NotesNotAllowedError when the token lacks notes:read
 */
export async function listPostNotes(token: string, subject: string | NoteSubject, max = 50, run: Run = bufferQuery): Promise<{ notes: BufferNote[]; more: boolean }> {
  const notes: BufferNote[] = [];
  let after: string | null = null;
  for (;;) {
    const first: number = Math.min(100, max - notes.length);
    const data: { collaborationNotes: { edges: { node: RawNote }[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } } } = await notesRequest(run, token,
      `query ListNotes($input: CollaborationNotesInput!, $first: Int, $after: String) { collaborationNotes(input: $input, first: $first, after: $after) { edges { node { ${NOTE_FIELDS} } } pageInfo { hasNextPage endCursor } } }`,
      { input: { subject: subjectOf(subject) }, first, after });
    notes.push(...data.collaborationNotes.edges.map((e) => toNote(e.node)));
    const { hasNextPage, endCursor } = data.collaborationNotes.pageInfo;
    if (!hasNextPage || !endCursor) return { notes, more: false };
    if (notes.length >= max) return { notes, more: true };
    after = endCursor;
  }
}

/** Buffer's typed refusal of a write: a closed thread, a limit, invalid input (including a mention it refused). */
export type NoteRefusal = { ok: false; kind: "closed" | "limit" | "invalid" | "other"; message: string };

/** A create's outcome: the saved note, or Buffer's typed refusal. */
export type CreateNoteResult = { ok: true; note: BufferNote } | NoteRefusal;

const refusal = (r: { __typename: string; message?: string }, fallback: string): NoteRefusal => ({
  ok: false,
  kind: r.__typename === "CollaborationNoteThreadClosedError" ? "closed" : r.__typename === "LimitReachedError" ? "limit" : r.__typename === "InvalidInputError" ? "invalid" : "other",
  message: r.message ?? fallback,
});

/**
 * Adds a note to a post or a channel-less draft. Never retried on a network failure, since Buffer may already have saved it.
 *
 * @param token - The person's Buffer access token
 * @param subject - A post id, or the subject itself (a post or a content item)
 * @param text - The note, at most MAX_NOTE characters
 * @param annotations - Its @mentions; Buffer refuses the whole note when a mentioned teammate cannot see the subject
 * @returns The saved note, or Buffer's refusal
 * @throws NotesNotAllowedError when the token lacks notes:write
 */
export async function createPostNote(token: string, subject: string | NoteSubject, text: string, run: Run = bufferQuery, annotations: MentionAnnotation[] = []): Promise<CreateNoteResult> {
  const data = await notesRequest<{ createCollaborationNote: { __typename: string; edge?: { node: RawNote }; message?: string } }>(run, token,
    `mutation CreateNote($input: CreateCollaborationNoteInput!) { createCollaborationNote(input: $input) { __typename ... on CreateCollaborationNoteSuccess { edge { node { ${NOTE_FIELDS} } } } ... on MutationError { message } } }`,
    { input: { subject: subjectOf(subject), text, annotations } });
  const r = data.createCollaborationNote;
  if (r.__typename === "CreateCollaborationNoteSuccess" && r.edge) return { ok: true, note: toNote(r.edge.node) };
  return refusal(r, "Buffer did not save the note.");
}

/**
 * Replaces a note's text and its mentions. Buffer checks again that this person may edit it, and clears every
 * mention not sent, so pass the ones to keep (see carryMentions).
 *
 * @param annotations - The note's mentions after the edit
 * @returns True when Buffer saved it, else Buffer's typed refusal
 */
export async function updatePostNote(token: string, noteId: string, text: string, run: Run = bufferQuery, annotations: MentionAnnotation[] = []): Promise<{ ok: true } | NoteRefusal> {
  const data = await notesRequest<{ updateCollaborationNote: { __typename: string; message?: string } }>(run, token,
    `mutation UpdateNote($input: UpdateCollaborationNoteInput!) { updateCollaborationNote(input: $input) { __typename ... on MutationError { message } } }`,
    { input: { noteId, text, annotations } });
  const r = data.updateCollaborationNote;
  return r.__typename === "UpdateCollaborationNoteSuccess" ? { ok: true } : refusal(r, "Buffer did not change the note.");
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

/** One @mention in a note, as Buffer's AnnotationInput takes it (displayValue is an optional documented field). */
export type MentionAnnotation = { type: "mention"; content: string; text: string; displayValue: string; serviceEntityId: string; indices: [number, number] };

/** A mention to place: the "@Name" span to find in the text, and who it names. */
export type WantedMention = { span: string; urn: string; displayValue: string };

/** A letter, digit or underscore right after a span means it is part of a longer name ("@Sam" in "@Samuel"). */
const continuesName = (ch: string | undefined) => !!ch && /[\p{L}\p{N}_]/u.test(ch);

/**
 * Finds each wanted mention in the text, in order, each at the first occurrence of its span that no earlier mention
 * took and that is not the start of a longer name. Offsets are JavaScript string offsets: UTF-16 code units, end
 * exclusive, as Buffer counts them.
 *
 * @param text - The note text
 * @param wanted - The mentions to place
 * @returns The annotations placed, in text order, and the spans not found
 */
export function placeMentions(text: string, wanted: WantedMention[]): { annotations: MentionAnnotation[]; missing: string[] } {
  const taken: [number, number][] = [];
  const annotations: MentionAnnotation[] = [];
  const missing: string[] = [];
  for (const w of wanted) {
    let at = text.indexOf(w.span);
    while (at >= 0 && (continuesName(text[at + w.span.length]) || taken.some(([s, e]) => at < e && at + w.span.length > s))) at = text.indexOf(w.span, at + 1);
    if (at < 0) { missing.push(w.span); continue; }
    const indices: [number, number] = [at, at + w.span.length];
    taken.push(indices);
    annotations.push({ type: "mention", content: w.span, text: w.span, displayValue: w.displayValue, serviceEntityId: w.urn, indices });
  }
  return { annotations: annotations.sort((a, b) => a.indices[0] - b.indices[0]), missing };
}

/**
 * The mentions an edited note keeps: each saved mention whose "@Name" still appears in the new text, at its new
 * offsets. A mention whose name was deleted from the text is dropped, as the person removed it.
 *
 * @param old - The note's saved mentions
 * @param text - The edited text
 * @returns The annotations to send with the update
 */
export function carryMentions(old: NoteMention[], text: string): MentionAnnotation[] {
  return placeMentions(text, [...old].sort((a, b) => a.indices[0] - b.indices[0]).map((m) => ({ span: m.text, urn: m.urn, displayValue: m.displayValue }))).annotations;
}

/** The "@Name" a teammate is written as: their name, or their email when they set no name. */
export const mentionSpan = (m: { name: string | null; email: string }) => `@${m.name?.trim() || m.email}`;

/**
 * Builds the @mention annotations for a note. Each teammate must already appear in the text as "@" plus their name
 * (or email when they set no name); the offsets point at that span, end exclusive (Buffer's "Create a Note with a
 * mention" example: type mention, the member's urn as serviceEntityId, content and text "@Name", indices).
 *
 * @param text - The note text
 * @param members - The teammates to mention, from selectableTeamMembers
 * @returns The annotations, or the names missing from the text
 */
export function mentionAnnotations(text: string, members: { name: string | null; email: string; urn: string }[]): { ok: true; annotations: MentionAnnotation[] } | { ok: false; missing: string[] } {
  const r = placeMentions(text, members.map((m) => { const span = mentionSpan(m); return { span, urn: m.urn, displayValue: span.slice(1) }; }));
  return r.missing.length ? { ok: false, missing: r.missing } : { ok: true, annotations: r.annotations };
}
