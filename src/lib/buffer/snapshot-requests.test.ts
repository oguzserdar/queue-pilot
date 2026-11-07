/**
 * @fileoverview How many Buffer requests a refresh of the saved copy costs. Buffer counts every request against the
 * app's shared limit and lets one query carry several top-level fields and up to 30 aliases, so a refresh asks for the
 * account, each organization's channels and the first page of its posts in one request, and only spends more when an
 * organization is new or has more than one page of posts.
 */
import { describe, expect, it } from "vitest";
import { BufferApiError, type bufferQuery } from "./client";
import { MAX_ALIASES } from "./queries";
import { MIN_REFRESH_MS, memorySnapshotStore, refreshSnapshot } from "./snapshot";

const NOW = new Date("2026-11-06T09:00:00Z");
const LATER = new Date(NOW.getTime() + MIN_REFRESH_MS + 1);

type Org = { id: string; posts: number };

/**
 * A fake Buffer that answers the way the GraphQL API does: each top-level field or alias in one request gets its own
 * key in the answer. It records every request and fails a request with more aliases than Buffer allows.
 */
function fakeBuffer(orgs: Org[], pageSize = 100) {
  const requests: string[] = [];
  const query = (async (_t: string, text: string, vars: Record<string, unknown> = {}, opts?: { onRateLimit?: (w: unknown) => void }) => {
    requests.push(text);
    opts?.onRateLimit?.([{ policy: "100-in-15m", remaining: 90, resetSeconds: 600 }]);
    const aliases = [...text.matchAll(/\b([a-z]\d+):\s*(channels|posts)\(/g)];
    if (aliases.length > MAX_ALIASES) throw new Error(`too many aliases: ${aliases.length}`);
    // Buffer fails the whole request when it names an organization the person no longer belongs to.
    const named = Object.entries(vars).flatMap(([k, v]) => /^o\d+$/.test(k) ? [v as string] : /^p\d+$|^input$/.test(k) ? [(v as { organizationId: string }).organizationId] : []);
    if (named.some((id) => !orgs.some((o) => o.id === id))) throw new BufferApiError("You do not have access to this organization", 200, "FORBIDDEN");
    const out: Record<string, unknown> = {};
    if (/\baccount\s*\{/.test(text)) out.account = { email: "a@b.co", timezone: "UTC", organizations: orgs.map((o) => ({ id: o.id, members: { totalCount: 1 } })) };
    const page = (orgId: string, after: string | null, first: number) => {
      const org = orgs.find((o) => o.id === orgId)!;
      const start = after ? Number(after) : 0;
      const n = Math.min(first, org.posts - start);
      return {
        edges: Array.from({ length: Math.max(0, n) }, (_, i) => ({ node: { id: `${orgId}-p${start + i}`, channelId: `${orgId}-c`, status: "draft", text: "", dueAt: null, sentAt: null, externalLink: null, error: null } })),
        pageInfo: { hasNextPage: start + n < org.posts, endCursor: start + n < org.posts ? String(start + n) : null },
      };
    };
    for (const [, alias, field] of aliases) {
      if (field === "channels") out[alias] = [{ id: `${vars[alias.replace("c", "o")]}-c`, name: "X" }];
      else {
        const input = vars[alias] as { organizationId: string };
        out[alias] = { ...page(input.organizationId, null, Number(vars.first ?? pageSize)) };
      }
    }
    if (!aliases.length && /\bposts\(/.test(text)) {
      const input = vars.input as { organizationId: string };
      out.posts = page(input.organizationId, (vars.after as string | null) ?? null, Number(vars.first));
    }
    if (!aliases.length && /\bchannels\(/.test(text)) out.channels = [{ id: `${vars.id}-c`, name: "X" }];
    return out;
  }) as unknown as typeof bufferQuery;
  return { query, requests };
}

describe("refresh request count", () => {
  it("costs one request for a known organization with one page of posts", async () => {
    const store = memorySnapshotStore();
    await refreshSnapshot("u1", "tok", { store, query: fakeBuffer([{ id: "o1", posts: 3 }]).query, now: () => NOW });
    const buffer = fakeBuffer([{ id: "o1", posts: 3 }]);
    const snap = await refreshSnapshot("u1", "tok", { store, query: buffer.query, now: () => LATER });
    expect(buffer.requests).toHaveLength(1);
    expect(snap?.data.posts).toHaveLength(3);
    expect(snap?.data.channels.map((c) => c.organizationId)).toEqual(["o1"]);
  });

  it("costs one request for several known organizations", async () => {
    const orgs = [{ id: "o1", posts: 2 }, { id: "o2", posts: 1 }, { id: "o3", posts: 0 }];
    const store = memorySnapshotStore();
    await refreshSnapshot("u1", "tok", { store, query: fakeBuffer(orgs).query, now: () => NOW });
    const buffer = fakeBuffer(orgs);
    const snap = await refreshSnapshot("u1", "tok", { store, query: buffer.query, now: () => LATER });
    expect(buffer.requests).toHaveLength(1);
    expect(snap?.data.organizationIds).toEqual(["o1", "o2", "o3"]);
    expect(snap?.data.posts.map((p) => p.id).sort()).toEqual(["o1-p0", "o1-p1", "o2-p0"]);
  });

  it("costs two requests the first time, when no organization is known yet", async () => {
    const buffer = fakeBuffer([{ id: "o1", posts: 1 }, { id: "o2", posts: 1 }]);
    const snap = await refreshSnapshot("u1", "tok", { store: memorySnapshotStore(), query: buffer.query, now: () => NOW });
    expect(buffer.requests).toHaveLength(2);
    expect(snap?.data.posts).toHaveLength(2);
  });

  it("reads a newly joined organization in one more request", async () => {
    const store = memorySnapshotStore();
    await refreshSnapshot("u1", "tok", { store, query: fakeBuffer([{ id: "o1", posts: 1 }]).query, now: () => NOW });
    const buffer = fakeBuffer([{ id: "o1", posts: 1 }, { id: "new", posts: 2 }]);
    const snap = await refreshSnapshot("u1", "tok", { store, query: buffer.query, now: () => LATER });
    expect(buffer.requests).toHaveLength(2);
    expect(snap?.data.organizationIds).toEqual(["o1", "new"]);
    expect(snap?.data.posts.map((p) => p.id).sort()).toEqual(["new-p0", "new-p1", "o1-p0"]);
  });

  it("starts from the account again when Buffer refuses an organization the person left", async () => {
    const store = memorySnapshotStore();
    await refreshSnapshot("u1", "tok", { store, query: fakeBuffer([{ id: "o1", posts: 1 }, { id: "gone", posts: 1 }]).query, now: () => NOW });
    const buffer = fakeBuffer([{ id: "o1", posts: 1 }, { id: "new", posts: 2 }]);
    const snap = await refreshSnapshot("u1", "tok", { store, query: buffer.query, now: () => LATER });
    expect(buffer.requests).toHaveLength(3);
    expect(snap?.data.organizationIds).toEqual(["o1", "new"]);
    expect(snap?.data.posts.map((p) => p.id).sort()).toEqual(["new-p0", "new-p1", "o1-p0"]);
    expect(snap?.data.channels.map((c) => c.organizationId).sort()).toEqual(["new", "o1"]);
  });

  it("reads posts 100 at a time and follows further pages only for the organization that has them", async () => {
    const orgs = [{ id: "big", posts: 250 }, { id: "small", posts: 4 }];
    const store = memorySnapshotStore();
    await refreshSnapshot("u1", "tok", { store, query: fakeBuffer(orgs).query, now: () => NOW });
    const buffer = fakeBuffer(orgs);
    const snap = await refreshSnapshot("u1", "tok", { store, query: buffer.query, now: () => LATER });
    expect(buffer.requests).toHaveLength(3);
    expect(snap?.data.posts).toHaveLength(254);
    expect(snap?.data.truncated).toBe(false);
  });

  it("stays within Buffer's 30 aliases when a person has many organizations", async () => {
    const orgs = Array.from({ length: 20 }, (_, i) => ({ id: `o${i}`, posts: 1 }));
    const store = memorySnapshotStore();
    await refreshSnapshot("u1", "tok", { store, query: fakeBuffer(orgs).query, now: () => NOW });
    const buffer = fakeBuffer(orgs);
    const snap = await refreshSnapshot("u1", "tok", { store, query: buffer.query, now: () => LATER });
    expect(buffer.requests).toHaveLength(2);
    expect(snap?.data.posts).toHaveLength(20);
  });

  it("sends a refused request once and does not ask again when the account's organizations did not change", async () => {
    const store = memorySnapshotStore();
    await refreshSnapshot("u1", "tok", { store, query: fakeBuffer([{ id: "o1", posts: 1 }]).query, now: () => NOW });
    const good = await store.get("u1");
    const requests: string[] = [];
    const query = (async (_t: string, text: string) => {
      requests.push(text);
      if (/c0: channels/.test(text)) throw new BufferApiError("Query has a validation error", 200, "GRAPHQL_VALIDATION_FAILED");
      return { account: { email: "a@b.co", timezone: "UTC", organizations: [{ id: "o1" }] } };
    }) as unknown as typeof bufferQuery;
    await expect(refreshSnapshot("u1", "tok", { store, query, now: () => LATER })).rejects.toThrow("validation error");
    expect(requests.filter((r) => /c0: channels/.test(r))).toHaveLength(1);
    expect(await store.get("u1")).toEqual(good);
  });

  it("keeps the last good copy when Buffer's answer leaves out an organization's posts", async () => {
    const store = memorySnapshotStore();
    await refreshSnapshot("u1", "tok", { store, query: fakeBuffer([{ id: "o1", posts: 1 }]).query, now: () => NOW });
    const good = await store.get("u1");
    const query = (async () => ({ account: { email: "a@b.co", timezone: "UTC", organizations: [{ id: "o1" }] }, c0: [{ id: "o1-c", name: "X" }] })) as unknown as typeof bufferQuery;
    await expect(refreshSnapshot("u1", "tok", { store, query, now: () => LATER })).rejects.toThrow("left out");
    expect(await store.get("u1")).toEqual(good);
  });

  it("marks the copy incomplete when Buffer says there are more posts but gives no cursor", async () => {
    const query = (async (_t: string, text: string) => /c0: channels/.test(text)
      ? { c0: [{ id: "o1-c", name: "X" }], p0: { edges: [], pageInfo: { hasNextPage: true, endCursor: null } } }
      : { account: { email: "a@b.co", timezone: "UTC", organizations: [{ id: "o1" }] } }) as unknown as typeof bufferQuery;
    const snap = await refreshSnapshot("u1", "tok", { store: memorySnapshotStore(), query, now: () => NOW });
    expect(snap?.data.truncated).toBe(true);
  });
});
