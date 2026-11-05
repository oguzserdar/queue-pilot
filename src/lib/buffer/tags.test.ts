/**
 * @fileoverview Buffer tags: documented types and fields only, paging, typed refusals, and setting tags keeps a draft
 * a draft.
 */
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { bufferReference, documentedFields } from "./reference.test-support";
import { createTag, deleteTag, listTags, setDraftTags, updateTag } from "./tags";

const REFERENCE = await bufferReference();
const fieldsOf = (type: string) => documentedFields(REFERENCE, type);

type Call = { query: string; variables: Record<string, unknown> };
function fake(answers: unknown[]) {
  const calls: Call[] = [];
  const run = vi.fn(async (_t: string, query: string, variables?: Record<string, unknown>) => {
    calls.push({ query, variables: variables ?? {} });
    return answers.shift();
  }) as unknown as typeof import("./client").bufferQuery;
  return { run, calls };
}
const tag = (id: string) => ({ id, name: `Tag ${id}`, color: "#8F2457", isLocked: false });

describe("Buffer tags", () => {
  it("control: a made-up type is caught", () => {
    expect(() => fieldsOf("MadeUpInput")).toThrow();
  });

  it("names only input types Buffer documents, and asks for and sends only documented fields", async () => {
    const { run, calls } = fake([
      { tagsV2: { edges: [], pageInfo: { hasNextPage: false, endCursor: null } } },
      { createTag: { __typename: "TagActionSuccess", tag: tag("t1") } },
      { post: { id: "p1", text: "Soup night.", status: "draft" } },
      { editPost: { __typename: "PostActionSuccess" } },
    ]);
    await listTags("t", "org", run);
    await createTag("t", "org", "Soups", undefined, run);
    expect(await setDraftTags("t", "p1", ["t1"], run)).toEqual({ ok: true });
    for (const c of calls) for (const [, type] of c.query.matchAll(/\$\w+: (\w+)!/g)) if (!["String", "Int"].includes(type)) expect(() => fieldsOf(type), type).not.toThrow();
    for (const f of ["id", "name", "color", "isLocked"]) expect(fieldsOf("Tag").has(f)).toBe(true);
    expect(fieldsOf("TagsInput").has("organizationId")).toBe(true);
    for (const f of ["organizationId", "tag"]) expect(fieldsOf("CreateTagInput").has(f)).toBe(true);
    for (const f of ["name", "color"]) expect(fieldsOf("TagToCreateInput").has(f)).toBe(true);
    for (const f of ["id", "text", "tagIds", "saveToDraft"]) expect(fieldsOf("EditPostInput").has(f)).toBe(true);
    expect(calls[1].variables).toEqual({ input: { organizationId: "org", tag: { name: "Soups", color: "#8F2457" } } });
    expect(calls[2].variables).toEqual({ input: { id: "p1" } });
    // Buffer reads a missing text as an empty post ("Post must have either text or media", fixed for approve in
    // v0.4), so the draft's own text, read just now, goes with the tags. It stays a draft; the time is not sent.
    expect(calls[3].variables).toEqual({ input: { id: "p1", text: "Soup night.", tagIds: ["t1"], saveToDraft: true } });
  });

  it("re-reads the post and refuses anything that is no longer a draft, without editing it", async () => {
    for (const status of ["scheduled", "sent", "needs_approval"]) {
      const { run, calls } = fake([{ post: { id: "p1", text: "Soup night.", status } }]);
      const r = await setDraftTags("t", "p1", ["t1"], run);
      expect(r.ok).toBe(false);
      expect(calls.some((c) => c.query.includes("editPost"))).toBe(false);
    }
  });

  it("reads every page, at 100 a page, up to a paid plan's 250", async () => {
    const { run, calls } = fake([
      { tagsV2: { edges: [{ node: tag("a") }], pageInfo: { hasNextPage: true, endCursor: "c1" } } },
      { tagsV2: { edges: [{ node: tag("b") }], pageInfo: { hasNextPage: false, endCursor: null } } },
    ]);
    expect((await listTags("t", "org", run)).map((t) => t.id)).toEqual(["a", "b"]);
    expect(calls.map((c) => c.variables.after)).toEqual([null, "c1"]);
    expect(calls[0].variables.first).toBe(100);
  });

  it("reports Buffer's refusals: duplicate name, plan limit, invalid input", async () => {
    const { run } = fake([
      { createTag: { __typename: "DuplicateError", message: "A tag with that name exists" } },
      { createTag: { __typename: "LimitReachedError", message: "Tag limit reached" } },
      { createTag: { __typename: "InvalidInputError", message: "Name too long" } },
      { post: { id: "p1", text: "Soup night.", status: "draft" } },
      { editPost: { __typename: "InvalidInputError", message: "Unknown tag" } },
    ]);
    expect(await createTag("t", "org", "Soups", undefined, run)).toMatchObject({ ok: false, kind: "duplicate" });
    expect(await createTag("t", "org", "Soups", undefined, run)).toMatchObject({ ok: false, kind: "limit" });
    expect(await createTag("t", "org", "x".repeat(101), undefined, run)).toMatchObject({ ok: false, kind: "invalid" });
    expect(await setDraftTags("t", "p1", ["nope"], run)).toEqual({ ok: false, message: "Unknown tag" });
  });
});

describe("tag rename and delete", () => {
  it("send only documented input fields and select only documented result fields", async () => {
    const { run, calls } = fake([
      { updateTag: { __typename: "TagActionSuccess", tag: tag("t1") } },
      { deleteTag: { __typename: "DeleteTagActionSuccess", id: "t1" } },
    ]);
    expect(await updateTag("t", "t1", "Soups", "#8F2457", run)).toEqual({ ok: true, value: tag("t1") });
    expect(await deleteTag("t", "t1", run)).toEqual({ ok: true, value: "t1" });
    expect(Object.keys(calls[0].variables.input as object).filter((k) => !fieldsOf("UpdateTagInput").has(k))).toEqual([]);
    expect(Object.keys((calls[0].variables.input as { tag: object }).tag).filter((k) => !fieldsOf("TagToUpdateInput").has(k))).toEqual([]);
    expect(Object.keys(calls[1].variables.input as object).filter((k) => !fieldsOf("DeleteTagInput").has(k))).toEqual([]);
    expect(fieldsOf("DeleteTagActionSuccess").has("id")).toBe(true);
    // Buffer asks new operations to select MutationError, not the error types it is removing.
    for (const c of calls) expect(c.query).not.toMatch(/NotFoundError|UnauthorizedError|UnexpectedError|RestProxyError/);
  });

  it("report Buffer's refusal kind", async () => {
    const { run } = fake([{ updateTag: { __typename: "DuplicateError", message: "Duplicate" } }, { deleteTag: { __typename: "InvalidInputError", message: "Bad id" } }]);
    expect(await updateTag("t", "t1", "Soups", "#8F2457", run)).toMatchObject({ ok: false, kind: "duplicate" });
    expect(await deleteTag("t", "t1", run)).toMatchObject({ ok: false, kind: "invalid", message: "Bad id" });
  });
});
