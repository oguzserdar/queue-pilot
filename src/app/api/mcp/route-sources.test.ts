/**
 * @fileoverview MCP route: source evidence, transcripts, web search and saved sources.
 * Shared mocks, fakes and helpers: src/test/mcp-route-setup.ts and src/test/fake-buffer-api.ts.
 */
import { answer, buffer, call, exaState, material, releaseXml, rpc, safeFetch, sourceCalls, typedSuccess, written } from "@/test/mcp-route-setup"
import { TOOL_OWNERS } from "@/test/mcp-tool-owners"
import { posts, setPosts } from "@/test/fake-buffer-api"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Written } from "@/lib/written-store"

describe("source evidence persistence", () => {
  it("does not grant QP ownership when evidence recording fails after Buffer saves", async () => {
    const store = await import("@/lib/source-store");
    vi.mocked(store.recordEvidence).mockRejectedValueOnce(new Error("storage unavailable"));
    const slotId = answer(await call("list_open_slots")).match(/ch@[^ ]+/)![0];
    const result = await call("save_drafts", { title: "Release", drafts: [{ slotId, text: "CSV export is live.", snapshotId: "snapshot-test", evidence: [{ claim: "CSV export is live.", quote: "CSV export is live." }] }] });
    expect(result.isError).not.toBe(true);
    expect(posts).toHaveLength(1);
    expect(answer(result)).toContain("evidence could not be recorded");
    expect(written.get("person-a") ?? []).toHaveLength(0);
    expect(buffer.calls.some(c => /schedulePost|publishPost/.test(c.query))).toBe(false);
  });
});


it("returns citations without repeating entire source documents for each draft", async () => {
  const { sourceCards } = await import("@/lib/source-presentation");
  setPosts([{ id: "p", channelId: "ch", text: "CSV export is live.", status: "draft", dueAt: "2026-11-02T09:00:00.000Z", sentAt: null, externalLink: null, error: null }]);
  written.set("person-a", [{ postId: "p", text: posts[0].text, network: "linkedin" }]);
  vi.mocked(sourceCards).mockResolvedValueOnce([{ postId: "p", snapshotId: "s", title: "Release", uri: "https://example.com", claim: "CSV export is live.", quote: "CSV export is live.", locator: null, lastCheckedAt: "2026-11-01", needsCheck: false, changed: false, scheduled: false, editable: true, oldText: "FULL OLD DOCUMENT", newText: "FULL NEW DOCUMENT", draftText: posts[0].text, why: "Quote matches" }]);
  const response = answer(await call("list_my_drafts"));
  expect(response).toContain('"quote": "CSV export is live."');
  expect(response).not.toContain("FULL OLD DOCUMENT");
  expect(response).not.toContain("FULL NEW DOCUMENT");
});

it("describes transcript acquisition as a write-capable credit-spending operation", async () => {
 const response = await rpc("tools/list", {});
 expect(response.result.tools.find((t: { name: string }) => t.name === "get_transcript").annotations.readOnlyHint).toBe(false);
});

it("read_material returns the video description when captions are unavailable", async () => {
 vi.mocked(safeFetch).mockImplementation(async () => new Response(releaseXml.replace("https://example.com/releases/v2", "https://youtube.com/watch?v=abcdefghijk")));
 await call("add_source", { url: "https://example.com/feed" });
 const key = answer(await call("list_new_material")).match(/key: (.+)/)![1];
 sourceCalls.transcript.mockResolvedValueOnce({ status: "not-configured", message: "No key" } as never);
 const result = JSON.parse(answer(await call("read_material", { key })));
 expect(result).toMatchObject({ kind: "video-description", text: "CSV export is live. Includes archived rows.", snapshotId: "snapshot-test", transcriptStatus: "not-configured" });
 expect(result.title).toContain("description only");
});

it("returns complete podcasts with the closing timestamp rather than an opening excerpt", async () => {
 const full = "Background. ".repeat(3000) + "Closing evidence.";
 sourceCalls.transcript.mockResolvedValueOnce({ status: "ready", text: full, truncated: false, captions: "unknown", segments: [{ text: "Closing evidence.", seconds: 7190 }] } as never);
 const result = JSON.parse(answer(await call("get_transcript", { url: "https://youtube.com/watch?v=abcdefghijk" })));
 expect(result).toMatchObject({ text: full, truncated: false, snapshotId: "snapshot-test", coverage: { fullTranscriptSaved: true, lastCaptionSeconds: 7190, selection: null } });
});
it("reads a closing passage from this account's saved snapshot without another paid fetch", async () => {
 const result = JSON.parse(answer(await call("get_transcript", { url: "https://youtu.be/abcdefghijk", snapshotId: "saved-podcast", startSeconds: 7190 })));
 expect(result).toMatchObject({ text: "Closing evidence.", snapshotId: "saved-podcast", coverage: { fullTranscriptSaved: true } });
 expect(sourceCalls.transcript).not.toHaveBeenCalled();
 expect((await call("get_transcript", { url: "https://youtu.be/abcdefghijk", snapshotId: "saved-podcast", startSeconds: 7190 }, "person-b")).isError).toBe(true);
 expect((await call("get_transcript", { url: "https://youtu.be/different123", snapshotId: "saved-podcast" })).isError).toBe(true);
});
it("searches the web through the operator's Exa key and never saves anything", async () => {
 exaState.search.mockResolvedValueOnce({ status: "ready", results: [{ title: "T", url: "https://example.com/a", publishedDate: null, author: null, excerpts: ["short"] }] });
 const result = JSON.parse(answer(await call("search_context", { query: "export limits", numResults: 3 })));
 expect(result.results[0].url).toBe("https://example.com/a");
 expect(exaState.search).toHaveBeenCalledWith({ query: "export limits", numResults: 3 }, "exa-test");
 expect((await material.list("person-a")).rows).toHaveLength(0);
});
it("says plainly when no Exa key is set", async () => {
 exaState.key = null;
 await call("search_context", { query: "anything" });
 expect(exaState.search).toHaveBeenLastCalledWith({ query: "anything" }, "");
 exaState.key = "exa-test";
});
it("keeps a read web page whole as a source snapshot with its link, for evidence", async () => {
 exaState.page.mockResolvedValueOnce({ status: "ready", page: { title: "Release notes", url: "https://example.com/notes#top", text: "Exports allow 1,000 rows.", truncated: false } });
 const result = JSON.parse(answer(await call("add_web_page", { url: "https://example.com/notes" })));
 expect(result).toMatchObject({ status: "saved", snapshotId: "snapshot-test", link: "https://example.com/notes#top", text: "Exports allow 1,000 rows.", truncated: false });
 expect((await material.list("person-a")).rows).toHaveLength(0);
});
it("returns a page longer than the old material limit without cutting its ending", async () => {
 const episode = `${"Host: question. Guest: answer. ".repeat(3000)}Guest: and that is the final correction.`;
 exaState.page.mockResolvedValueOnce({ status: "ready", page: { title: "Episode", url: "https://example.com/ep", text: episode, truncated: false } });
 const result = JSON.parse(answer(await call("add_web_page", { url: "https://example.com/ep" })));
 expect(result.characters).toBe(episode.length);
 expect(result.text.endsWith("final correction.")).toBe(true);
 expect(result.truncated).toBe(false);
});
it("tells the AI when a page passed the size ceiling and stores it as an excerpt, never as the whole", async () => {
 exaState.page.mockResolvedValueOnce({ status: "ready", page: { title: "Huge", url: "https://example.com/huge", text: "Opening of a huge page.", truncated: true } });
 expect(JSON.parse(answer(await call("add_web_page", { url: "https://example.com/huge" })))).toMatchObject({ status: "saved", truncated: true });
 expect(sourceCalls.captured.at(-1)).toEqual([expect.objectContaining({ sourceKey: "web:https://example.com/huge", uri: "https://example.com/huge" }), { truncated: true }]);
});
it("stores a complete page as complete, under its address without the fragment", async () => {
 exaState.page.mockResolvedValueOnce({ status: "ready", page: { title: "Notes", url: "https://example.com/notes#top", text: "Whole page.", truncated: false } });
 await call("add_web_page", { url: "https://example.com/notes" });
 expect(sourceCalls.captured.at(-1)).toEqual([expect.objectContaining({ sourceKey: "web:https://example.com/notes", uri: "https://example.com/notes" }), { truncated: false }]);
});
it("sends the AI from search_context to add_web_page and its snapshotId, not to read_material", async () => {
 const tools = (await rpc("tools/list", {})).result.tools as { name: string; description: string }[];
 const description = tools.find((t) => t.name === "search_context")!.description;
 expect(description).toContain("add_web_page");
 expect(description).toContain("snapshotId");
 expect(description).not.toContain("read_material");
});
it("saves nothing when the page cannot be read", async () => {
 const result = JSON.parse(answer(await call("add_web_page", { url: "https://example.com/gone" })));
 expect(result.status).toBe("failed");
 expect((await material.list("person-a")).rows).toHaveLength(0);
});
it("rejects a search or page address that is not a web address", async () => {
 expect((await call("add_web_page", { url: "javascript:alert(1)" })).isError).toBe(true);
 expect((await call("search_context", { query: "x", category: "videos" })).isError).toBe(true);
 expect((await call("search_context", { query: "x", numResults: 50 })).isError).toBe(true);
});
it("marks the Exa tools as not read-only, because they spend credits", async () => {
 const response = await rpc("tools/list", {});
 for (const name of ["search_context", "add_web_page"]) expect(response.result.tools.find((t: { name: string }) => t.name === name).annotations.readOnlyHint).toBe(false);
});
it("rejects a backwards time range before spending transcript credits", async () => {
 expect((await call("get_transcript", { url: "https://youtu.be/abcdefghijk", startSeconds: 7190, endSeconds: 12 })).isError).toBe(true);
 expect(sourceCalls.transcript).not.toHaveBeenCalled();
});


describe("saved source validation without transcript round-trip", () => {
  const input = { sourceKey: "yt:abcdefghijk", uri: "https://youtube.com/watch?v=abcdefghijk", snapshotId: "long-podcast" };
  beforeEach(() => sourceCalls.list.mockResolvedValue([{ sourceKey: input.sourceKey, uri: input.uri, evidence: [{ postId: "post-a" }] }] as never));
  it("passes the full stored transcript and asks for a first semantic check", async () => {
    const result = await call("report_source_version", input);
    expect(result.isError).not.toBe(true);
    expect(sourceCalls.report).toHaveBeenCalledWith("person-a", expect.objectContaining({ text: "Whole transcript. ".repeat(5000) + "Closing evidence.", expectedSnapshotId: "long-podcast", validateUnchanged: true }), expect.any(Function), expect.objectContaining({ kind: "transcript" }));
    expect(JSON.parse(answer(result))).toMatchObject({ checkedAgainst: "saved-source" });
  });
  it("rejects another account's snapshot and a mismatched source before inference", async () => {
    expect((await call("report_source_version", input, "person-b")).isError).toBe(true);
    sourceCalls.list.mockResolvedValue([{ sourceKey: "different", uri: input.uri, evidence: [] }] as never);
    expect((await call("report_source_version", { ...input, sourceKey: "different" })).isError).toBe(true);
    expect(sourceCalls.report).not.toHaveBeenCalled();
  });
  it("rejects ambiguous and missing source content", async () => {
    expect((await call("report_source_version", { ...input, text: "partial" })).isError).toBe(true);
    const { snapshotId: _id, ...missing } = input;
    expect((await call("report_source_version", missing)).isError).toBe(true);
    expect(sourceCalls.report).not.toHaveBeenCalled();
  });
});


it("exposes exact evidence wording and repairs an existing owned draft without a Buffer write", async () => {
 const tools = (await rpc("tools/list", {})).result.tools;
 for (const name of ["save_drafts", "update_draft"]) {
   const tool = tools.find((t: { name: string }) => t.name === name);
   const evidence = name === "save_drafts" ? tool.inputSchema.properties.drafts.items.properties.evidence : tool.inputSchema.properties.evidence;
   expect(evidence.items.properties.claim.description).toContain("Do not paraphrase");
   expect(evidence.items.properties.quote.description).toContain("word for word");
 }
 setPosts([{ id: "repair", channelId: "ch", text: "CSV export is live.", status: "draft", via: "api", dueAt: "2026-11-02T09:00:00Z", sentAt: null, externalLink: null, error: null }]);
 written.set("person-a", [{ postId: "repair", network: "linkedin", text: posts[0].text }] as Written[]);
 const args = { postId: "repair", text: posts[0].text, expectedText: posts[0].text, snapshotId: "snapshot-test", evidence: [{ claim: posts[0].text, quote: posts[0].text }] };
 const before = structuredClone(posts);
 expect((await call("update_draft", args)).isError).not.toBe(true);
 expect(sourceCalls.repair).toHaveBeenCalledWith("person-a", "repair", posts[0].text, "snapshot-test", args.evidence);
 expect(posts).toEqual(before);
 sourceCalls.repair.mockClear();
 expect((await call("update_draft", args, "person-b")).isError).toBe(true);
 expect((await call("update_draft", { ...args, expectedText: undefined })).isError).toBe(true);
 expect(sourceCalls.repair).not.toHaveBeenCalled();
});

describe("typed results proven in this file", () => {
  it("returns typed data from every tool this file proves", () => {
    expect(TOOL_OWNERS["sources"].filter((tool) => !typedSuccess.has(tool))).toEqual([])
  })
})
