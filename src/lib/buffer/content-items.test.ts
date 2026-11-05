/**
 * @fileoverview Buffer content items: every request document is checked against Buffer's published types (each error
 * fragment names a type that can appear there, every input and selected field is documented, every required post
 * field is sent), promotion only ever creates drafts, and refusals keep Buffer's reasons.
 */
import { describe, expect, it, vi } from "vitest";
import { bufferReference, documentedFields, typeSection } from "./reference.test-support";
import {
  addPostToContentItem, createChannelLessDraft, deleteContentItem, FAILURE, getContentItem, ITEM_FIELDS, listContentItems,
  promotePostInputs, promoteToDraftPosts, removePostFromContentItem, updateChannelLessDraft, updateContentItem,
} from "./content-items";

const REFERENCE = await bufferReference();
const fieldsOf = (type: string) => documentedFields(REFERENCE, type);
/** Union members from "**Possible types:** A | B". */
const possible = (union: string) => (typeSection(REFERENCE, union).match(/\*\*Possible types:\*\* (.+)/)?.[1] ?? "").split("|").map((t) => t.trim()).filter(Boolean);
const implementsIt = (type: string, iface: string) => new RegExp(`\\*\\*Implements:\\*\\*[^\\n]*\\b${iface}\\b`).test(typeSection(REFERENCE, type));
/** The type of one field, without list or non-null marks. */
const fieldType = (type: string, field: string) => typeSection(REFERENCE, type).match(new RegExp(`^- \`${field}\`: \`\\[?(\\w+)`, "m"))?.[1];
/** Required fields: non-null with no documented default. */
const required = (type: string) => [...typeSection(REFERENCE, type).matchAll(/^- `(\w+)`: `[^`]*!`(?! \(default)/gm)].map((m) => m[1]);

type Call = { query: string; variables: Record<string, any> };
function fake(answers: unknown[]) {
  const calls: Call[] = [];
  const run = vi.fn(async (_t: string, query: string, variables?: Record<string, unknown>) => {
    calls.push({ query, variables: variables ?? {} });
    return answers.shift();
  }) as unknown as typeof import("./client").bufferQuery;
  return { run, calls };
}
const draftItem = { id: "ci1", organizationId: "org", title: "Issue 41", targetDate: null, createdAt: "2026-11-05T00:00:00Z", allowedActions: ["updateContentItem", "deleteContentItem"], tags: [], body: { __typename: "DraftContent", text: "Soup night.", aiAssisted: true } };
const postsItem = { ...draftItem, body: { __typename: "PostContent", posts: [{ id: "p1", channelId: "x", status: "draft", text: "Soup.", dueAt: null }] } };

describe("request documents match Buffer's published types", () => {
  it("control: a made-up union member or field is caught", () => {
    expect(possible("PromoteContentItemDraftToPostsError")).not.toContain("PostNotDeletableError");
    expect(fieldsOf("ContentItem").has("notARealFieldQP")).toBe(false);
  });

  it("each failure's error fragments name only types that can appear in that failure's errors list", () => {
    const failures: [keyof typeof FAILURE, string][] = [["createDraft", "CreateContentItemDraftFailure"], ["update", "UpdateContentItemFailure"], ["updateDraft", "UpdateContentItemDraftFailure"], ["promote", "PromoteContentItemDraftToPostsFailure"], ["remove", "DeleteContentItemFailure"]];
    const wrong: string[] = [];
    for (const [key, failure] of failures) {
      const sel = FAILURE[key];
      expect(sel).toContain(`... on ${failure} {`);
      const errorsType = fieldType(failure, "errors")!;
      const members = (() => { try { return possible(errorsType); } catch { return []; } })();
      const inside = sel.slice(sel.indexOf("errors {"));
      for (const [, t] of inside.matchAll(/\.\.\. on (\w+)/g)) {
        const ok = members.length ? (members.includes(t) || (t === "MutationError" && members.every((m) => implementsIt(m, "MutationError")))) : t === errorsType;
        if (!ok) wrong.push(`${failure}.errors: ${t}`);
      }
      // Fields selected straight on an object-typed errors list must exist on it.
      if (!members.length) for (const f of inside.replace(/errors \{|\}/g, "").split(/\s+/).filter((w) => /^\w+$/.test(w) && w !== "__typename")) if (!fieldsOf(errorsType).has(f)) wrong.push(`${errorsType}.${f}`);
    }
    expect(wrong).toEqual([]);
  });

  it("selects only documented content item, draft, post and tag fields", () => {
    let flat = ITEM_FIELDS;
    while (/\{[^{}]*\}/.test(flat)) flat = flat.replace(/\{[^{}]*\}/g, "");
    const top = flat.replace(/\.\.\. on \w+/g, "").split(/\s+/).filter((w) => /^\w+$/.test(w));
    expect(top.filter((f) => !fieldsOf("ContentItem").has(f))).toEqual([]);
    for (const f of ["text", "aiAssisted", "assets"]) expect(fieldsOf("DraftContent").has(f)).toBe(true);
    expect(fieldsOf("Asset").has("type")).toBe(true);
    for (const f of ["id", "channelId", "status", "text", "dueAt"]) expect(fieldsOf("Post").has(f)).toBe(true);
    for (const f of ["id", "name"]) expect(fieldsOf("Tag").has(f)).toBe(true);
    expect(possible("ContentItemBody").sort()).toEqual(["DraftContent", "PostContent"]);
  });

  it("names documented input types and sends only documented input fields", async () => {
    const { run, calls } = fake([
      { contentItems: { edges: [], pageInfo: { hasNextPage: false, endCursor: null } } },
      { contentItem: draftItem },
      { createContentItemDraft: { __typename: "CreateContentItemDraftSuccess", contentItem: draftItem } },
      { updateContentItemDraft: { __typename: "UpdateContentItemDraftSuccess", contentItem: draftItem } },
      { promoteContentItemDraftToPosts: { __typename: "PromoteContentItemDraftToPostsSuccess", contentItem: postsItem } },
      { updateContentItem: { __typename: "UpdateContentItemSuccess", contentItem: draftItem } },
      { deleteContentItem: { __typename: "EmptySuccess", _empty: "" } },
      { addPostToContentItem: { __typename: "AddPostToContentItemSuccess", contentItem: postsItem } },
      { removePostFromContentItem: { __typename: "RemovePostFromContentItemSuccess", contentItem: postsItem } },
    ]);
    await listContentItems("t", "org", { status: "draftContent" }, run);
    await getContentItem("t", "ci1", run);
    await createChannelLessDraft("t", "org", { text: "Soup night.", title: "Issue 41", targetDate: "2026-11-10T09:00:00.000Z", correlationId: "00000000-0000-4000-8000-000000000000" }, run);
    await updateChannelLessDraft("t", "ci1", "Soup night!", run);
    await promoteToDraftPosts("t", "ci1", [{ channelId: "x", text: "Soup." }, { channelId: "li", text: "Soup night.", dueAt: "2026-11-10T09:00:00.000Z" }], run);
    await updateContentItem("t", "ci1", { title: null }, run);
    await deleteContentItem("t", "ci1", run);
    await addPostToContentItem("t", "ci1", "p1", run);
    await removePostFromContentItem("t", "ci1", "p1", run);
    const unknown: string[] = [];
    for (const c of calls) {
      const [, inputType] = c.query.match(/\$input: (\w+)!/) ?? [];
      expect(() => fieldsOf(inputType), inputType).not.toThrow();
      for (const k of Object.keys(c.variables.input)) if (!fieldsOf(inputType).has(k)) unknown.push(`${inputType}.${k}`);
    }
    const nested: [Record<string, unknown>, string][] = [
      [calls[0].variables.input.filter, "ContentItemsFilter"],
      [calls[2].variables.input.draft, "DraftContentInput"],
      [calls[3].variables.input.draft, "DraftContentInput"],
      ...calls[4].variables.input.posts.map((p: Record<string, unknown>) => [p, "CreatePostInput"] as [Record<string, unknown>, string]),
    ];
    for (const [obj, type] of nested) for (const k of Object.keys(obj)) if (!fieldsOf(type).has(k)) unknown.push(`${type}.${k}`);
    expect(unknown).toEqual([]);
  });
});

describe("promotion only ever creates drafts", () => {
  it("sends every required CreatePostInput field, with saveToDraft true and no approval request on every post", () => {
    const inputs = promotePostInputs([{ channelId: "x", text: "a" }, { channelId: "li", text: "b", dueAt: "2026-11-10T09:00:00.000Z" }]);
    const need = required("CreatePostInput");
    expect(need).toEqual(expect.arrayContaining(["channelId", "mode", "schedulingType"]));
    for (const p of inputs) {
      for (const f of need) expect(p, f).toHaveProperty(f);
      expect(p).toMatchObject({ saveToDraft: true, needsApproval: false, assets: [], aiAssisted: true });
    }
    expect(inputs[0]).toMatchObject({ mode: "addToQueue" });
    expect(inputs[0]).not.toHaveProperty("dueAt");
    expect(inputs[1]).toMatchObject({ mode: "customScheduled", dueAt: "2026-11-10T09:00:00.000Z" });
  });

  it("sends one promote request and never falls back to scheduling or creating posts another way", async () => {
    const { run, calls } = fake([{ promoteContentItemDraftToPosts: { __typename: "PromoteContentItemDraftToPostsFailure", message: "Invalid", errors: [{ __typename: "PostInvalidInputError", message: "Too long", channelId: "x" }] } }]);
    const r = await promoteToDraftPosts("t", "ci1", [{ channelId: "x", text: "a" }], run);
    expect(r).toEqual({ ok: false, message: "Invalid", errors: [{ message: "Too long", kind: "PostInvalidInputError", channelId: "x" }] });
    expect(calls).toHaveLength(1);
    expect(calls.every((c) => !/createPost|createContentItem\(|editPost/.test(c.query))).toBe(true);
  });
});

describe("content item results", () => {
  it("reads a channel-less draft and a posts item into one shape", async () => {
    const { run } = fake([{ contentItems: { edges: [{ node: draftItem }, { node: postsItem }], pageInfo: { hasNextPage: false, endCursor: null } } }]);
    const r = await listContentItems("t", "org", {}, run);
    expect(r.items.map((i) => i.body.kind)).toEqual(["draft", "posts"]);
    expect(r.items[0].body).toEqual({ kind: "draft", text: "Soup night.", aiAssisted: true, mediaCount: 0 });
  });

  it("marks a new channel-less draft as written with AI and passes the idempotency id", async () => {
    const { run, calls } = fake([{ createContentItemDraft: { __typename: "CreateContentItemDraftSuccess", contentItem: draftItem } }]);
    await createChannelLessDraft("t", "org", { text: "Soup night.", correlationId: "u-1" }, run);
    expect(calls[0].variables.input).toEqual({ organizationId: "org", correlationId: "u-1", draft: { text: "Soup night.", aiAssisted: true, assets: [] } });
  });

  it("keeps every blocked channel when a delete is refused", async () => {
    const { run } = fake([{ deleteContentItem: { __typename: "DeleteContentItemFailure", message: "Blocked", errors: [{ __typename: "PostNotDeletableError", message: "Published", channelId: "x" }] } }]);
    expect(await deleteContentItem("t", "ci1", run)).toEqual({ ok: false, message: "Blocked", errors: [{ message: "Published", kind: "PostNotDeletableError", channelId: "x" }] });
  });
});
