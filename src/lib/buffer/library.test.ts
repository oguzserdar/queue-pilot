/**
 * @fileoverview Buffer's template library, snippets, selectable teammates and channel configuration: every query names
 * only documented types and fields, pages are followed and merged, placeholders fill exactly, and a channel's own
 * text limit is read from its configuration.
 */
import { describe, expect, it, vi } from "vitest";
import { bufferReference, documentedFields } from "./reference.test-support";
import { fillTemplate, getTemplate, listTemplates, placeholdersIn } from "./templates";
import { listSnippets, SnippetsNotAllowedError } from "./snippets";
import { BufferApiError } from "./client";
import { readPages } from "./paging";
import { channelSettings, listTeamMembers, postingState, postTextLimit, type ChannelSettings } from "./workspace";

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
const page = <T>(key: string, nodes: T[], next: string | null = null) => ({ [key]: { edges: nodes.map((node) => ({ node })), pageInfo: { hasNextPage: next !== null, endCursor: next } } });

/** Fields selected directly inside `name { ... }` (one level, fragments ignored). */
function selected(query: string, name: string): string[] {
  const start = query.indexOf(`${name} {`);
  if (start < 0) return [];
  let depth = 0, out = "", i = query.indexOf("{", start);
  for (; i < query.length; i++) {
    const ch = query[i];
    if (ch === "{") { depth++; if (depth === 1) continue; }
    if (ch === "}") { depth--; if (depth === 0) break; }
    if (depth === 1) out += ch;
  }
  return out.replace(/\.\.\. on \w+/g, "").split(/\s+/).filter((w) => /^\w+$/.test(w));
}

const template = (id: string, body = "Shipped {{feature}}.") => ({ id, title: `T ${id}`, description: "d", emoji: "🚀", body, visibility: "public", organizationId: "org", updatedAt: "2026-11-05T00:00:00Z" });

describe("documented types and fields", () => {
  it("control: a made-up type or field is caught", () => {
    expect(() => fieldsOf("MadeUpInput")).toThrow();
    expect(fieldsOf("PostTemplate").has("notARealFieldQP")).toBe(false);
  });

  it("every query names documented input types and selects documented fields", async () => {
    const { run, calls } = fake([
      page("postTemplates", []),
      { postTemplate: null },
      page("snippets", []),
      page("selectableTeamMembers", []),
      { configuration: { channels: [] } },
    ]);
    await listTemplates("t", "org", { visibility: "internal" }, run);
    await getTemplate("t", "tpl", run);
    await listSnippets("t", "org", null, run);
    await listTeamMembers("t", { organizationId: "org" }, { search: "ana" }, run);
    await channelSettings("t", "org", run);
    for (const c of calls) for (const [, type] of c.query.matchAll(/\$\w+: (\w+)!/g)) if (!["String", "Int"].includes(type)) expect(() => fieldsOf(type), type).not.toThrow();
    const checks: [string, string, string][] = [
      [calls[0].query, "node", "PostTemplate"],
      [calls[1].query, "postTemplate(input: $input)", "PostTemplate"],
      [calls[2].query, "node", "Snippet"],
      [calls[3].query, "node", "SelectableTeamMember"],
      [calls[4].query, "channels", "ChannelConfiguration"],
      [calls[4].query, "authorizationStatus", "FeatureAuthorizationStatus"],
      [calls[4].query, "content", "ContentConfiguration"],
    ];
    const missing = checks.flatMap(([q, at, type]) => selected(q, at).filter((f) => !fieldsOf(type).has(f)).map((f) => `${type}.${f}`));
    expect(missing).toEqual([]);
    expect(fieldsOf("LengthRule").has("maxLength") && fieldsOf("CountRule").has("max")).toBe(true);
  });

  it("sends only documented input fields", async () => {
    const { run, calls } = fake([page("postTemplates", []), page("selectableTeamMembers", [])]);
    await listTemplates("t", "org", { visibility: "private" }, run);
    await listTeamMembers("t", { channelId: "ch" }, { search: "ana" }, run);
    const unknown = (input: Record<string, unknown>, type: string) => Object.keys(input).filter((k) => !fieldsOf(type).has(k));
    expect(unknown(calls[0].variables.input as Record<string, unknown>, "PostTemplatesInput")).toEqual([]);
    expect(unknown((calls[0].variables.input as { filter: Record<string, unknown> }).filter, "PostTemplatesFilterInput")).toEqual([]);
    expect(unknown(calls[1].variables.input as Record<string, unknown>, "SelectableTeamMembersInput")).toEqual([]);
    expect(unknown((calls[1].variables.input as { scope: Record<string, unknown> }).scope, "TeamMemberSelectionScopeInput")).toEqual([]);
  });
});

describe("templates", () => {
  it("follows pages until Buffer says there are no more", async () => {
    const { run, calls } = fake([page("postTemplates", [template("a")], "c1"), page("postTemplates", [template("b")])]);
    expect(await listTemplates("t", "org", {}, run)).toEqual({ items: [template("a"), template("b")], more: false, cursor: null });
    expect(calls[1].variables.after).toBe("c1");
    expect(calls[0].variables.input).toEqual({ organizationId: "org" });
  });

  it("finds each placeholder once, in order, ignoring spaces inside the braces", () => {
    expect(placeholdersIn("New in {{ product }}: {{feature}}. {{product}} again.")).toEqual(["product", "feature"]);
  });

  it("fills known placeholders and leaves missing ones visible", () => {
    expect(fillTemplate("Shipped {{feature}}. Try it: {{ link }}", { feature: "CSV export" })).toEqual({ text: "Shipped CSV export. Try it: {{ link }}", missing: ["link"] });
    expect(fillTemplate("{{a}}", { a: "   " }).missing).toEqual(["a"]);
  });

  it("treats a placeholder named like a built-in (constructor, toString) as missing, not as filled", () => {
    expect(fillTemplate("{{constructor}} and {{toString}}", {})).toEqual({ text: "{{constructor}} and {{toString}}", missing: ["constructor", "toString"] });
    expect(fillTemplate("{{toString}}", { toString: "ok" } as Record<string, string>).text).toBe("ok");
  });
});

describe("snippets and teammates", () => {
  it("reads every snippet page", async () => {
    const { run } = fake([page("snippets", [{ id: "s1", name: "Launch", text: "#buildinpublic" }], "c"), page("snippets", [{ id: "s2", name: "Soup", text: "#soup" }])]);
    expect((await listSnippets("t", "org", null, run)).items.map((s) => s.name)).toEqual(["Launch", "Soup"]);
  });

  it("merges teammate pages by id, because Buffer's list is live", async () => {
    const ana = { id: "a1", name: "Ana", email: "a@x", avatar: "", isLocked: false, urn: "urn:buffer:account:a1" };
    const { run } = fake([page("selectableTeamMembers", [ana], "c"), page("selectableTeamMembers", [ana, { ...ana, id: "b2", name: "Bo" }])]);
    expect((await listTeamMembers("t", { organizationId: "org" }, {}, run)).items.map((m) => m.id)).toEqual(["a1", "b2"]);
  });
});

describe("channel configuration", () => {
  it("reads the channel's own post text limit and its feature statuses", async () => {
    const { run } = fake([{ configuration: { channels: [{
      channelId: "x1", service: "twitter", channelType: "profile",
      authorizationStatus: [{ feature: "posting", status: "ok", reason: null }],
      content: [
        { configurationContentTypes: ["post"], rules: [{ __typename: "LengthRule", property: "text", maxLength: 280 }, { __typename: "CountRule", property: "image", min: null, max: 4 }, { __typename: "FormatRule", property: "video" }] },
        { configurationContentTypes: ["comment"], rules: [{ __typename: "LengthRule", property: "text", maxLength: 500 }] },
      ],
    }] } }]);
    const [x] = await channelSettings("t", "org", run);
    expect(postTextLimit(x)).toBe(280);
    expect(x.content[0].rules).toEqual([{ kind: "length", property: "text", maxLength: 280 }, { kind: "count", property: "image", min: null, max: 4 }]);
    expect(x.features[0]).toEqual({ feature: "posting", status: "ok", reason: null });
  });

  it("has no limit when Buffer gives no post text rule", () => {
    expect(postTextLimit({ channelId: "c", service: "s", channelType: "p", features: [], content: [{ types: ["story"], rules: [] }] })).toBeNull();
  });
});

describe("partial lists are never presented as whole", () => {
  const p = (nodes: number[], hasNextPage: boolean, endCursor: string | null) => async () => ({ nodes, hasNextPage, endCursor });

  it("stops at the page budget and hands back the cursor to continue", async () => {
    const pages = [p([1], true, "c1"), p([2], true, "c2"), p([3], true, "c3")];
    let i = 0;
    expect(await readPages(() => pages[i++](), 2)).toEqual({ items: [1, 2], more: true, cursor: "c2" });
  });

  it("stops when Buffer repeats a cursor or gives none, and still says more exist", async () => {
    const repeat = [p([1], true, "c1"), p([2], true, "c1")];
    let i = 0;
    expect(await readPages(() => repeat[i++](), 5)).toEqual({ items: [1, 2], more: true, cursor: null });
    expect(await readPages(p([1], true, null), 5)).toEqual({ items: [1], more: true, cursor: null });
  });

  it("continues from a given cursor", async () => {
    const seen: (string | null)[] = [];
    await readPages(async (after) => { seen.push(after); return { nodes: [], hasNextPage: false, endCursor: null }; }, 3, "from-here");
    expect(seen).toEqual(["from-here"]);
  });
});

describe("snippet permission", () => {
  it("turns a missing snippets permission into a sign-in-again error, by code or by message", async () => {
    const byCode = fake([]);
    (byCode.run as unknown as { mockImplementationOnce: (f: () => never) => void }).mockImplementationOnce(() => { throw new BufferApiError("Forbidden", 200, "INSUFFICIENT_SCOPE"); });
    await expect(listSnippets("t", "org", null, byCode.run)).rejects.toBeInstanceOf(SnippetsNotAllowedError);
    const byText = fake([]);
    (byText.run as unknown as { mockImplementationOnce: (f: () => never) => void }).mockImplementationOnce(() => { throw new BufferApiError("missing scope snippets:read", 200); });
    await expect(listSnippets("t", "org", null, byText.run)).rejects.toBeInstanceOf(SnippetsNotAllowedError);
    const other = fake([]);
    (other.run as unknown as { mockImplementationOnce: (f: () => never) => void }).mockImplementationOnce(() => { throw new BufferApiError("Buffer API returned 500", 500); });
    await expect(listSnippets("t", "org", null, other.run)).rejects.not.toBeInstanceOf(SnippetsNotAllowedError);
  });
});

describe("posting state", () => {
  const ch = (features: ChannelSettings["features"]): ChannelSettings => ({ channelId: "c", service: "twitter", channelType: "profile", features, content: [] });

  it("is ok only with an explicit ok posting entry from Buffer", () => {
    expect(postingState(ch([{ feature: "posting", status: "ok", reason: null }]))).toEqual({ state: "ok" });
  });

  it("is unknown when Buffer reports no posting entry, even if every other feature is fine", () => {
    expect(postingState(ch([]))).toEqual({ state: "unknown" });
    expect(postingState(ch([{ feature: "comment", status: "ok", reason: null }]))).toEqual({ state: "unknown" });
  });

  it("is blocked with Buffer's status and reason, and an unrelated failure never blocks posting", () => {
    expect(postingState(ch([{ feature: "posting", status: "needsRefresh", reason: "Token expired" }]))).toEqual({ state: "blocked", status: "needsRefresh", reason: "Token expired" });
    expect(postingState(ch([{ feature: "posting", status: "ok", reason: null }, { feature: "insights", status: "notEnoughData", reason: null }]))).toEqual({ state: "ok" });
  });
});
