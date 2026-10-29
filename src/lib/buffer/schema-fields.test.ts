import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CHANNEL_FIELDS, POST_FIELDS, type Post } from "./queries";
import { saveDrafts } from "../save-drafts";
import { approveDrafts } from "../approve-drafts";

// Buffer's API refuses unauthenticated queries before validating fields, so field names are checked here against a
// saved copy of developers.buffer.com/reference.md (fixtures/, saved 21 Oct 2026). Refresh the copy when Buffer's
// changelog changes a type.
const REFERENCE = readFileSync(join(__dirname, "fixtures/buffer-api-reference.md"), "utf8");

/** The field names documented under "#### <type>" in the reference. */
function fieldsOf(type: string): Set<string> {
  const start = REFERENCE.indexOf(`\n#### ${type}\n`);
  if (start < 0) throw new Error(`type ${type} not in the reference`);
  const next = REFERENCE.indexOf("\n#### ", start + 6);
  const section = REFERENCE.slice(start, next < 0 ? undefined : next);
  return new Set([...section.matchAll(/^- `(\w+)`:/gm)].map((m) => m[1]));
}

/** Splits "a b { c d } e" into top-level fields with their sub-selections. */
function selection(fields: string): { name: string; sub: string | null }[] {
  const out: { name: string; sub: string | null }[] = [];
  const re = /(\w+)\s*(\{([^{}]*)\})?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(fields))) out.push({ name: m[1], sub: m[3] ?? null });
  return out;
}

const NESTED: Record<string, string> = { error: "PostPublishingError", assets: "Asset" };

describe("Buffer fields we query", () => {
  it("control: a made-up field is caught", () => {
    expect(fieldsOf("Post").has("notARealFieldQP")).toBe(false);
    expect(fieldsOf("Post").has("text")).toBe(true);
  });

  it("every field in the channels query exists on Buffer's Channel and ScheduleV2 types", () => {
    const channel = fieldsOf("Channel");
    const missing: string[] = [];
    for (const f of selection(CHANNEL_FIELDS)) {
      if (!channel.has(f.name)) missing.push(`Channel.${f.name}`);
      if (f.sub) for (const g of selection(f.sub)) if (!fieldsOf("ScheduleV2").has(g.name)) missing.push(`ScheduleV2.${g.name}`);
    }
    expect(missing).toEqual([]);
  });

  it("the account query asks only for documented fields", () => {
    expect(fieldsOf("Account").has("email") && fieldsOf("Account").has("organizations")).toBe(true);
  });

  it("every field in the posts query exists on Buffer's Post type and its nested types", () => {
    const post = fieldsOf("Post");
    const missing: string[] = [];
    for (const f of selection(POST_FIELDS)) {
      if (!post.has(f.name)) missing.push(`Post.${f.name}`);
      if (f.sub) {
        const type = NESTED[f.name];
        const known = fieldsOf(type);
        for (const g of selection(f.sub)) if (!known.has(g.name)) missing.push(`${type}.${g.name}`);
      }
    }
    expect(missing).toEqual([]);
  });
});

/** Runs a real write path against a fake Buffer and returns every GraphQL input object it sent. */
async function sentInputs(run: (q: any) => Promise<unknown>): Promise<{ query: string; input: Record<string, unknown> }[]> {
  const sent: { query: string; input: Record<string, unknown> }[] = [];
  const q = async (_t: string, query: string, variables?: { input?: Record<string, unknown> }) => {
    if (variables?.input) sent.push({ query, input: variables.input });
    if (query.includes("dailyPostingLimits")) return { dailyPostingLimits: [] };
    if (query.includes("createContentItem")) return { createContentItem: { __typename: "CreateContentItemSuccess" } };
    if (query.includes("editPost")) return { editPost: { __typename: "PostActionSuccess" } };
    return { createPost: { __typename: "PostActionSuccess" } };
  };
  await run(q);
  return sent;
}

const unknownKeys = (input: Record<string, unknown>, type: string) => {
  const known = fieldsOf(type);
  return Object.keys(input).filter((k) => !known.has(k)).map((k) => `${type}.${k}`);
};

describe("Buffer inputs we send", () => {
  const slot = { id: "x@2026-11-02T09:00:00.000Z", channelId: "x", channel: "X", service: "twitter", organizationId: "o", at: "2026-11-02T09:00:00.000Z", local: "Mon", timezone: "UTC" };

  it("saving drafts sends only documented fields", async () => {
    const sent = await sentInputs((q) => saveDrafts("t", { title: "w", drafts: [{ slotId: slot.id, text: "hi" }], open: [slot] }, q));
    const missing: string[] = [];
    for (const s of sent) {
      if (s.query.includes("dailyPostingLimits")) missing.push(...unknownKeys(s.input, "DailyPostingLimitsInput"));
      if (s.query.includes("createContentItem")) {
        missing.push(...unknownKeys(s.input, "CreateContentItemInput"));
        for (const p of s.input.posts as Record<string, unknown>[]) missing.push(...unknownKeys(p, "CreatePostInput"));
      }
    }
    expect(sent.map((s) => (s.query.includes("dailyPostingLimits") ? "limits" : "item"))).toEqual(["limits", "item"]);
    expect(missing).toEqual([]);
  });

  it("saving drafts asks back only for documented fields: the content item's posts and their ids", () => {
    expect(fieldsOf("ContentItem").has("id") && fieldsOf("ContentItem").has("body")).toBe(true);
    expect(fieldsOf("PostContent").has("posts")).toBe(true);
    expect(["id", "channelId"].every((f) => fieldsOf("Post").has(f))).toBe(true);
    expect(fieldsOf("CreateContentItemSuccess").has("content")).toBe(true);
  });

  it("approving drafts sends only documented fields", async () => {
    const draft = { id: "p1", channelId: "x", status: "draft", text: "hi", dueAt: "2026-11-02T09:00:00.000Z", sentAt: null, externalLink: null, error: null } as Post;
    const sent = await sentInputs((q) => approveDrafts("t", ["p1"], [draft], new Date("2026-11-01T00:00:00Z"), new Set(["p1"]), q));
    expect(sent).toHaveLength(1);
    expect(unknownKeys(sent[0].input, "EditPostInput")).toEqual([]);
  });
});

describe("first-rules query fields", () => {
  it("asks only for fields Buffer documents on Post and Note", () => {
    for (const f of ["id", "channelId", "text", "sentAt", "notes"]) expect(fieldsOf("Post").has(f)).toBe(true);
    for (const f of ["text", "type", "createdAt", "author"]) expect(fieldsOf("Note").has(f)).toBe(true);
    expect(fieldsOf("Author").has("name")).toBe(true);
  });
});

