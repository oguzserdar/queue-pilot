/**
 * @fileoverview Buffer collaboration Notes: documented fields only, paging, the missing-permission case, typed
 * refusals, and no retry after a failed create.
 */
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { bufferReference, documentedFields } from "./reference.test-support";
import { BufferApiError } from "./client";
import { createPostNote, deletePostNote, listPostNotes, NotesNotAllowedError, updatePostNote } from "./notes";

const REFERENCE = await bufferReference();
const fieldsOf = (type: string) => documentedFields(REFERENCE, type);

const node = (id: string, author: { id: string; name: string } | null = { id: "a1", name: "Sara" }) => ({ id, text: `note ${id}`, authorId: "a1", author, allowedActions: ["updateNote"], createdAt: "2026-11-03T10:00:00Z", updatedAt: "2026-11-03T10:00:00Z" });
type Call = { query: string; variables: Record<string, unknown> };
function fake(answers: unknown[]) {
  const calls: Call[] = [];
  const run = vi.fn(async (_t: string, query: string, variables?: Record<string, unknown>) => {
    calls.push({ query, variables: variables ?? {} });
    const a = answers.shift();
    if (a instanceof Error) throw a;
    return a;
  }) as unknown as typeof import("./client").bufferQuery;
  return { run, calls };
}

describe("Buffer Notes", () => {
  it("control: a made-up field is caught", () => {
    expect(fieldsOf("CollaborationNote").has("madeUpField")).toBe(false);
  });

  it("asks only for fields Buffer documents on CollaborationNote and Author, and sends only documented inputs", async () => {
    const { run, calls } = fake([
      { collaborationNotes: { edges: [], pageInfo: { hasNextPage: false, endCursor: null } } },
      { createCollaborationNote: { __typename: "CreateCollaborationNoteSuccess", edge: { node: node("n1") } } },
    ]);
    await listPostNotes("t", "p1", 10, run);
    await createPostNote("t", "p1", "Please check the quote.", run);
    for (const f of ["id", "text", "authorId", "author", "allowedActions", "createdAt", "updatedAt"]) expect(fieldsOf("CollaborationNote").has(f)).toBe(true);
    for (const f of ["id", "name", "avatar"]) expect(fieldsOf("Author").has(f)).toBe(true);
    expect(fieldsOf("CollaborationNoteSubjectInput").has("postId")).toBe(true);
    for (const f of ["subject", "text", "annotations"]) expect(fieldsOf("CreateCollaborationNoteInput").has(f)).toBe(true);
    expect(fieldsOf("CollaborationNotesInput").has("subject")).toBe(true);
    expect(calls[0].variables).toEqual({ input: { subject: { postId: "p1" } }, first: 10, after: null });
    expect(calls[1].variables).toEqual({ input: { subject: { postId: "p1" }, text: "Please check the quote.", annotations: [] } });
  });

  it("follows pages up to the limit and says when more exist; a deleted author has no name", async () => {
    const { run, calls } = fake([
      { collaborationNotes: { edges: [{ node: node("n1") }, { node: node("n2", null) }], pageInfo: { hasNextPage: true, endCursor: "c2" } } },
      { collaborationNotes: { edges: [{ node: node("n3") }], pageInfo: { hasNextPage: true, endCursor: "c3" } } },
    ]);
    const r = await listPostNotes("t", "p1", 3, run);
    expect(r.notes.map((n) => [n.id, n.author])).toEqual([["n1", "Sara"], ["n2", null], ["n3", "Sara"]]);
    expect(r.more).toBe(true);
    expect(calls[1].variables).toMatchObject({ first: 1, after: "c2" });
  });

  it("turns a missing Notes permission into a sign-in-again error, by code or by message", async () => {
    const byCode = fake([new BufferApiError("Forbidden", 200, "INSUFFICIENT_SCOPE")]);
    await expect(listPostNotes("t", "p1", 10, byCode.run)).rejects.toBeInstanceOf(NotesNotAllowedError);
    const byText = fake([new BufferApiError("insufficient scope: notes:write", 200)]);
    await expect(createPostNote("t", "p1", "x", byText.run)).rejects.toBeInstanceOf(NotesNotAllowedError);
    const other = fake([new BufferApiError("Buffer API returned 500", 500)]);
    await expect(listPostNotes("t", "p1", 10, other.run)).rejects.not.toBeInstanceOf(NotesNotAllowedError);
  });

  it("reports Buffer's typed refusals instead of pretending the note was saved", async () => {
    const { run } = fake([
      { createCollaborationNote: { __typename: "CollaborationNoteThreadClosedError", message: "Thread closed" } },
      { createCollaborationNote: { __typename: "LimitReachedError", message: "Too many notes" } },
    ]);
    expect(await createPostNote("t", "p1", "x", run)).toEqual({ ok: false, kind: "closed", message: "Thread closed" });
    expect(await createPostNote("t", "p1", "x", run)).toEqual({ ok: false, kind: "limit", message: "Too many notes" });
  });

  it("never retries a create that failed on the network, since Buffer may have saved it", async () => {
    const { run, calls } = fake([new TypeError("fetch failed")]);
    await expect(createPostNote("t", "p1", "x", run)).rejects.toThrow("fetch failed");
    expect(calls).toHaveLength(1);
  });

  it("updates and deletes report success only on Buffer's success type", async () => {
    const { run } = fake([
      { updateCollaborationNote: { __typename: "UpdateCollaborationNoteSuccess" } },
      { updateCollaborationNote: { __typename: "InvalidInputError", message: "Too long" } },
      { deleteCollaborationNote: { __typename: "DeleteCollaborationNoteSuccess", noteId: "n1" } },
    ]);
    expect(await updatePostNote("t", "n1", "new", run)).toEqual({ ok: true });
    expect(await updatePostNote("t", "n1", "new", run)).toEqual({ ok: false, message: "Too long" });
    expect(await deletePostNote("t", "n1", run)).toEqual({ ok: true });
  });
});
