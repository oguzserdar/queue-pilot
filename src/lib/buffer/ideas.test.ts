/**
 * @fileoverview Buffer ideas board: documented fields only, columns by name, paging, both success shapes, typed
 * refusals, and no retry after a failed create.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createIdea, IDEA_SERVICES, listIdeas } from "./ideas";

const REFERENCE = readFileSync(join(__dirname, "fixtures/buffer-api-reference.md"), "utf8");
function section(type: string): string {
  const start = REFERENCE.indexOf(`\n#### ${type}\n`);
  if (start < 0) throw new Error(`type ${type} not in the reference`);
  const next = REFERENCE.indexOf("\n#### ", start + 6);
  return REFERENCE.slice(start, next < 0 ? undefined : next);
}
const fieldsOf = (type: string) => new Set([...section(type).matchAll(/^- `(\w+)`:/gm)].map((m) => m[1]));

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
const idea = (id: string, groupId: string | null = null) => ({ id, organizationId: "org", groupId, createdAt: 1_762_160_400, content: { title: `Idea ${id}`, text: null, services: ["linkedin"], date: null } });

describe("Buffer ideas board", () => {
  it("control: a made-up field is caught", () => {
    expect(fieldsOf("Idea").has("madeUpField")).toBe(false);
  });

  it("asks only for documented fields and sends only documented inputs", async () => {
    const { run, calls } = fake([{ ideaGroups: [] }, { ideas: { edges: [], pageInfo: { hasNextPage: false, endCursor: null } } }, { createIdea: { __typename: "Idea", id: "i9" } }]);
    await listIdeas("t", "org", 10, run);
    await createIdea("t", "org", { title: "Soup week", text: "Three soups", services: ["linkedin"], groupId: "g1" }, run);
    for (const f of ["id", "name", "isLocked"]) expect(fieldsOf("IdeaGroup").has(f)).toBe(true);
    for (const f of ["id", "organizationId", "groupId", "createdAt", "content"]) expect(fieldsOf("Idea").has(f)).toBe(true);
    for (const f of ["title", "text", "services", "date"]) expect(fieldsOf("IdeaContent").has(f)).toBe(true);
    expect(fieldsOf("IdeasInput").has("organizationId")).toBe(true);
    for (const f of ["organizationId", "content", "group"]) expect(fieldsOf("CreateIdeaInput").has(f)).toBe(true);
    for (const f of ["aiAssisted", "title", "text", "services"]) expect(fieldsOf("IdeaContentInput").has(f)).toBe(true);
    expect(fieldsOf("IdeaGroupInput").has("groupId")).toBe(true);
    // Every service Queue Pilot offers is one Buffer accepts.
    for (const s of IDEA_SERVICES) expect(section("Service")).toContain(`- \`${s}\``);
    expect(calls[2].variables).toEqual({ input: { organizationId: "org", content: { aiAssisted: true, title: "Soup week", text: "Three soups", services: ["linkedin"] }, group: { groupId: "g1" } } });
  });

  it("names each idea's column, follows pages up to the limit and turns Buffer's seconds into a date", async () => {
    const { run, calls } = fake([
      { ideaGroups: [{ id: "g1", name: "Next week", isLocked: false }] },
      { ideas: { edges: [{ node: idea("i1", "g1") }, { node: idea("i2") }], pageInfo: { hasNextPage: true, endCursor: "c2" } } },
      { ideas: { edges: [{ node: idea("i3", "gone") }], pageInfo: { hasNextPage: true, endCursor: "c3" } } },
    ]);
    const r = await listIdeas("t", "org", 3, run);
    expect(r.ideas.map((i) => [i.id, i.group])).toEqual([["i1", "Next week"], ["i2", null], ["i3", null]]);
    expect(r.more).toBe(true);
    expect(r.ideas[0].createdAt).toBe("2025-11-03T09:00:00.000Z");
    expect(calls[2].variables).toMatchObject({ first: 1, after: "c2" });
  });

  it("accepts both success shapes and reports Buffer's typed refusals", async () => {
    const { run } = fake([
      { createIdea: { __typename: "Idea", id: "i1" } },
      { createIdea: { __typename: "IdeaResponse", idea: { id: "i2" } } },
      { createIdea: { __typename: "LimitReachedError", message: "Ideas limit reached" } },
      { createIdea: { __typename: "IdeaResponse", idea: null } },
    ]);
    expect(await createIdea("t", "org", { title: "a" }, run)).toEqual({ ok: true, id: "i1" });
    expect(await createIdea("t", "org", { title: "b" }, run)).toEqual({ ok: true, id: "i2" });
    expect(await createIdea("t", "org", { title: "c" }, run)).toEqual({ ok: false, kind: "limit", message: "Ideas limit reached" });
    expect(await createIdea("t", "org", { title: "d" }, run)).toMatchObject({ ok: false, kind: "other" });
  });

  it("never retries a create that failed on the network, since Buffer may have saved it", async () => {
    const { run, calls } = fake([new TypeError("fetch failed")]);
    await expect(createIdea("t", "org", { title: "x" }, run)).rejects.toThrow("fetch failed");
    expect(calls).toHaveLength(1);
  });
});
