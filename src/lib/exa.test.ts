/**
 * @fileoverview Web search and page reading through Exa: what is asked, what is kept, and that every failure is a
 * plain status. No request leaves the test: fetch is injected.
 */
import { describe, expect, it, vi } from "vitest";
import { PAGE_CEILING, readPage, searchWeb } from "./exa";

const reply = (status: number, body: unknown = {}) => vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
const sent = (f: typeof fetch) => JSON.parse(String((vi.mocked(f).mock.calls[0][1] as RequestInit).body));

describe("searchWeb", () => {
  it("asks for short excerpts, never whole pages, and keeps only what the AI needs", async () => {
    const f = reply(200, { results: [
      { title: "Release notes", url: "https://example.com/a", publishedDate: "2026-10-30", author: "Mark", highlights: ["  Exports   now allow\n1,000 rows. ", "Second", "Third", "Fourth"], text: "WHOLE PAGE", id: "x" },
      { title: "No link", url: "ftp://example.com/b" },
      { url: "https://example.com/c" },
    ] });
    const r = await searchWeb({ query: "export limits", category: "news", numResults: 99, since: "2026-10-01T00:00:00Z", domains: ["example.com"] }, "k", f);
    expect(sent(f)).toMatchObject({ query: "export limits", type: "auto", numResults: 8, category: "news", startPublishedDate: "2026-10-01T00:00:00Z", includeDomains: ["example.com"], contents: { highlights: { maxCharacters: 1800 } } });
    expect(sent(f).contents.text).toBeUndefined();
    expect(vi.mocked(f).mock.calls[0][1]).toMatchObject({ headers: { "x-api-key": "k" } });
    expect(r).toEqual({ status: "ready", results: [
      { title: "Release notes", url: "https://example.com/a", publishedDate: "2026-10-30", author: "Mark", excerpts: ["Exports now allow 1,000 rows.", "Second", "Third"] },
      { title: "https://example.com/c", url: "https://example.com/c", publishedDate: null, author: null, excerpts: [] },
    ] });
  });

  it("limits a podcast search to the podcast library, whatever sites were also named", async () => {
    const f = reply(200, { results: [] });
    await searchWeb({ query: "hiring", podcasts: true, domains: ["example.com"] }, "k", f);
    expect(sent(f).includeDomains).toEqual(["exa.ai/library/podcast"]);
  });

  it("says plainly when there is no key, without a request", async () => {
    const f = reply(200);
    expect(await searchWeb({ query: "x" }, "", f)).toMatchObject({ status: "not-configured" });
    expect(f).not.toHaveBeenCalled();
  });

  it.each([[401, "invalid-key"], [403, "invalid-key"], [402, "out-of-credits"], [429, "rate-limited"], [500, "failed"]])("turns a %i answer into %s", async (code, status) => {
    expect(await searchWeb({ query: "x" }, "k", reply(code))).toMatchObject({ status });
  });

  it("turns a network failure and a malformed answer into a failed status", async () => {
    expect(await searchWeb({ query: "x" }, "k", vi.fn(async () => { throw new Error("offline"); }) as unknown as typeof fetch)).toMatchObject({ status: "failed" });
    expect(await searchWeb({ query: "x" }, "k", reply(200, { results: "nope" }))).toMatchObject({ status: "failed" });
  });
});

describe("readPage", () => {
  it("returns a long podcast page whole, with its ending", async () => {
    const episode = `${"Host: question. Guest: answer. ".repeat(3000)}Guest: and that is the final correction.`;
    expect(episode.length).toBeGreaterThan(90_000);
    const r = await readPage("https://example.com/a", "k", reply(200, { results: [{ title: "T", url: "https://example.com/a", text: episode }], statuses: [{ id: "https://example.com/a", status: "success" }] }));
    expect(r).toMatchObject({ status: "ready", page: { title: "T", truncated: false } });
    if (r.status === "ready") expect(r.page.text.endsWith("final correction.")).toBe(true);
  });

  it("says when a page passed the ceiling and keeps exactly the ceiling", async () => {
    const r = await readPage("https://example.com/a", "k", reply(200, { results: [{ title: "T", url: "https://example.com/a", text: "a".repeat(PAGE_CEILING + 50) }] }));
    expect(r).toMatchObject({ status: "ready", page: { truncated: true } });
    if (r.status === "ready") expect(r.page.text.length).toBe(PAGE_CEILING);
  });

  it("does not call a page that is exactly the ceiling long cut", async () => {
    const r = await readPage("https://example.com/a", "k", reply(200, { results: [{ title: "T", url: "https://example.com/a", text: "a".repeat(PAGE_CEILING) }] }));
    expect(r).toMatchObject({ status: "ready", page: { truncated: false } });
  });

  it("asks only for text, one more character than it keeps", async () => {
    const f = reply(200, { results: [{ title: "T", url: "https://example.com/a", text: "hi" }] });
    await readPage("https://example.com/a", "k", f);
    expect(sent(f)).toEqual({ urls: ["https://example.com/a"], text: { maxCharacters: PAGE_CEILING + 1 } });
  });

  it("reports a cut page as cut even when collapsing whitespace shrinks the prefix below the ceiling", async () => {
    const raw = "a\n\n".repeat(Math.ceil((PAGE_CEILING + 1) / 3)).slice(0, PAGE_CEILING + 1);
    expect(raw.replace(/\s+/g, " ").trim().length).toBeLessThan(PAGE_CEILING);
    const r = await readPage("https://example.com/a", "k", reply(200, { results: [{ title: "T", url: "https://example.com/a", text: raw }] }));
    expect(r).toMatchObject({ status: "ready", page: { truncated: true } });
  });

  it("does not call a whole page cut because it ends in whitespace", async () => {
    const r = await readPage("https://example.com/a", "k", reply(200, { results: [{ title: "T", url: "https://example.com/a", text: `${"a".repeat(PAGE_CEILING - 2)}\n\n` }] }));
    expect(r).toMatchObject({ status: "ready", page: { truncated: false } });
  });

  it("turns null envelopes, entries and statuses into plain statuses instead of throwing", async () => {
    expect(await readPage("https://example.com/a", "k", reply(200, null))).toMatchObject({ status: "failed" });
    expect(await readPage("https://example.com/a", "k", reply(200, { results: [null] }))).toMatchObject({ status: "failed" });
    expect(await readPage("https://example.com/a", "k", reply(200, { results: [{ title: "T", text: "Body" }], statuses: [null] }))).toMatchObject({ status: "ready" });
    expect(await searchWeb({ query: "x" }, "k", reply(200, null))).toMatchObject({ status: "failed" });
    expect(await searchWeb({ query: "x" }, "k", reply(200, { results: [null, "text", { url: "https://example.com/ok", title: "Ok" }] }))).toMatchObject({ status: "ready", results: [{ url: "https://example.com/ok" }] });
  });

  it("keeps the requested address when Exa returns one that is not a public web address", async () => {
    const r = await readPage("https://example.com/a", "k", reply(200, { results: [{ title: "T", url: "https://user:pass@example.com/a", text: "Body" }] }));
    expect(r).toMatchObject({ status: "ready", page: { url: "https://example.com/a" } });
    const broken = await readPage("https://example.com/a", "k", reply(200, { results: [{ title: "T", url: "https://", text: "Body" }] }));
    expect(broken).toMatchObject({ status: "ready", page: { url: "https://example.com/a" } });
  });

  it("refuses an address with embedded sign-in details before any request", async () => {
    const f = reply(200);
    expect(await readPage("https://user:pass@example.com/a", "k", f)).toMatchObject({ status: "failed" });
    expect(f).not.toHaveBeenCalled();
  });

  it("never turns a page Exa could not fetch into empty text", async () => {
    const failed = reply(200, { results: [{ title: "T", url: "https://example.com/a", text: "Not found" }], statuses: [{ id: "https://example.com/a", status: "error", error: { tag: "CRAWL_NOT_FOUND", httpStatusCode: 404 } }] });
    expect(await readPage("https://example.com/a", "k", failed)).toMatchObject({ status: "failed" });
    expect(await readPage("https://example.com/a", "k", reply(200, { results: [] }))).toMatchObject({ status: "failed" });
    expect(await readPage("https://example.com/a", "k", reply(200, { results: [{ title: "T", text: "   " }] }))).toMatchObject({ status: "failed" });
  });

  it("refuses a non-web address and a missing key before any request", async () => {
    const f = reply(200);
    expect(await readPage("javascript:alert(1)", "k", f)).toMatchObject({ status: "failed" });
    expect(await readPage("https://example.com/a", "", f)).toMatchObject({ status: "not-configured" });
    expect(f).not.toHaveBeenCalled();
  });
});
