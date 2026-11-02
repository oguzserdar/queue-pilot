import { describe, expect, it, vi, beforeEach } from "vitest";
vi.mock("server-only", () => ({}));
const state = vi.hoisted(() => ({ response: null as unknown, reports: vi.fn(), transcript: vi.fn(), uri: "https://example.com/post", old: { text: "Old source", metadata: { truncated: false, kind: "transcript", etag: '"version-1"' } } }));
vi.mock("./source-check", () => ({ listSourcesToCheck: async () => [{ sourceKey: "feed:item", uri: state.uri, title: "Post", lastCheckedAt: "2026-11-01T00:00:00Z" }], reportSourceVersion: (...args: unknown[]) => state.reports(...args) }));
vi.mock("./sources-store", () => ({ postgresSourceStore: () => ({ list: async () => [{ id: "feed", url: "https://example.com/feed" }] }) }));
vi.mock("./source-store", () => ({ latestSource: async () => state.old }));
vi.mock("./safe-fetch", () => ({ safeFetch: vi.fn(async () => state.response), BlockedAddressError: class extends Error {} }));
vi.mock("./transcript-for-user", () => ({ transcriptForUser: (...a: unknown[]) => state.transcript(...a) }));
const { checkSources } = await import("./check-sources");
const { safeFetch } = await import("./safe-fetch");
beforeEach(() => { state.uri = "https://example.com/post"; state.old.metadata.truncated = false; state.reports.mockReset(); state.reports.mockResolvedValue({ changed: false, proposals: 0, pending: 0, scheduled: [] }); });
describe("feed checks", () => {
  it("keeps the old snapshot on an outage or missing item", async () => {
    state.response = new Response("down", { status: 404 });
    await checkSources("u", async () => []); expect(state.reports).not.toHaveBeenCalled();
    state.response = new Response('<rss version="2.0"><channel><title>Feed</title><link>https://example.com</link><description>Empty</description></channel></rss>');
    await checkSources("u", async () => []); expect(state.reports).not.toHaveBeenCalled();
  });
  it("sends conditional headers and reuses old text on 304 for pending checks", async () => {
    state.response = new Response(null, { status: 304 });
    await checkSources("u", async () => []);
    expect(safeFetch).toHaveBeenLastCalledWith(expect.any(URL), expect.objectContaining({ headers: expect.objectContaining({ "If-None-Match": '"version-1"' }) }));
    expect(state.reports).toHaveBeenCalledWith("u", expect.objectContaining({ text: "Old source" }), expect.any(Function), expect.any(Object));
  });
});

it("upgrades an older opening excerpt to the full current transcript", async () => {
 state.uri = "https://youtube.com/watch?v=abcdefghijk"; state.old.metadata.truncated = true;
 state.transcript.mockResolvedValue({ status: "ready", text: "Full episode including the final correction", truncated: false, captions: "unknown", segments: [] });
 await checkSources("u", async () => []);
 expect(state.reports).toHaveBeenCalledWith("u", expect.objectContaining({ text: "Full episode including the final correction" }), expect.any(Function), expect.objectContaining({ truncated: false }));
});
it("checks changed feed excerpts when the saved version was also an excerpt", async () => {
 state.old.metadata.truncated = true;
 state.response = new Response('<rss version="2.0"><channel><title>Feed</title><link>https://example.com</link><description>Feed</description><item><guid>item</guid><title>Post</title><description>Updated text. Read more</description></item></channel></rss>');
 await checkSources("u", async () => []); expect(state.reports).toHaveBeenCalled();
});
it("does not mistake an incomplete provider response for a source change, even from an old excerpt", async () => {
 state.uri = "https://youtube.com/watch?v=abcdefghijk"; state.old.metadata.truncated = true;
 state.transcript.mockResolvedValue({ status: "ready", text: "Only an unidentified section", truncated: true, captions: "unknown", segments: [] });
 const result = await checkSources("u", async () => []);
 expect(state.reports).not.toHaveBeenCalled(); expect(result[0].message).toContain("complete transcript");
});
