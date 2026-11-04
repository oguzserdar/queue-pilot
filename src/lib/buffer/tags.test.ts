/**
 * @fileoverview Buffer tags: documented types and fields only, paging, typed refusals, and setting tags keeps a draft
 * a draft.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createTag, listTags, setDraftTags } from "./tags";

const REFERENCE = readFileSync(join(__dirname, "fixtures/buffer-api-reference.md"), "utf8");
function fieldsOf(type: string): Set<string> {
  const start = REFERENCE.indexOf(`\n#### ${type}\n`);
  if (start < 0) throw new Error(`type ${type} not in the reference`);
  const next = REFERENCE.indexOf("\n#### ", start + 6);
  return new Set([...REFERENCE.slice(start, next < 0 ? undefined : next).matchAll(/^- `(\w+)`:/gm)].map((m) => m[1]));
}

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
      { editPost: { __typename: "PostActionSuccess" } },
    ]);
    await listTags("t", "org", run);
    await createTag("t", "org", "Soups", undefined, run);
    await setDraftTags("t", "p1", ["t1"], run);
    for (const c of calls) for (const [, type] of c.query.matchAll(/\$\w+: (\w+)!/g)) if (!["String", "Int"].includes(type)) expect(() => fieldsOf(type), type).not.toThrow();
    for (const f of ["id", "name", "color", "isLocked"]) expect(fieldsOf("Tag").has(f)).toBe(true);
    expect(fieldsOf("TagsInput").has("organizationId")).toBe(true);
    for (const f of ["organizationId", "tag"]) expect(fieldsOf("CreateTagInput").has(f)).toBe(true);
    for (const f of ["name", "color"]) expect(fieldsOf("TagToCreateInput").has(f)).toBe(true);
    for (const f of ["id", "tagIds", "saveToDraft"]) expect(fieldsOf("EditPostInput").has(f)).toBe(true);
    expect(calls[1].variables).toEqual({ input: { organizationId: "org", tag: { name: "Soups", color: "#8F2457" } } });
    // Setting tags never schedules: the draft stays a draft, and text and time are not sent at all.
    expect(calls[2].variables).toEqual({ input: { id: "p1", tagIds: ["t1"], saveToDraft: true } });
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
      { editPost: { __typename: "InvalidInputError", message: "Unknown tag" } },
    ]);
    expect(await createTag("t", "org", "Soups", undefined, run)).toMatchObject({ ok: false, kind: "duplicate" });
    expect(await createTag("t", "org", "Soups", undefined, run)).toMatchObject({ ok: false, kind: "limit" });
    expect(await createTag("t", "org", "x".repeat(101), undefined, run)).toMatchObject({ ok: false, kind: "invalid" });
    expect(await setDraftTags("t", "p1", ["nope"], run)).toEqual({ ok: false, message: "Unknown tag" });
  });
});
