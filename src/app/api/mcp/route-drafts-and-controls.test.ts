/**
 * @fileoverview MCP route: the draft chain and the connector's controls.
 * Shared mocks, fakes and helpers: src/test/mcp-route-setup.ts and src/test/fake-buffer-api.ts.
 */
import { aiCalls, answer, buffer, call, dismissed, lastAction, material, newMaterial, ruleStore, rules, safeFetch, sources, typedSuccess, voices, written } from "@/test/mcp-route-setup"
import { TOOL_OWNERS } from "@/test/mcp-tool-owners"
import { libFake, posts, setPosts } from "@/test/fake-buffer-api"
import { describe, expect, it, vi } from "vitest"
import type { Post } from "@/lib/buffer/queries"

describe("connector draft chain", () => {
  it("reads release text, learns voice, checks rules, saves, shows, edits and deletes its own drafts", async () => {
    rules.set("person-a", [{ id: "stock", kind: "replace", from: "broth", to: "stock", channels: "all", level: "block", text: "Say stock instead of broth." }])
    expect((await call("add_source", { url: "https://github.com/example/app/releases" })).isError).not.toBe(true)
    expect(String(vi.mocked(safeFetch).mock.calls[0][0])).toBe("https://github.com/example/app/releases.atom")
    const listed = answer(await call("list_new_material"))
    const key = listed.match(/key: (.+)/)![1]
    expect(answer(await call("read_material", { key }))).toContain("CSV export is live. Includes archived rows.")
    expect((await call("read_material", { key }, "person-b")).isError).toBe(true)
    await call("save_my_voice_note", { note: "Short and plain" })
    await call("add_voice_example", { text: "Shipped it. Here is what changed." })
    expect(answer(await call("get_my_voice"))).toContain("Shipped it")
    expect(answer(await call("get_playbook"))).toContain("enforced")
    const slotId = answer(await call("list_open_slots")).match(/ch@[^ ]+/)![0]
    const rejected = await call("save_drafts", { title: "Release", drafts: [{ slotId, text: "broth export" }] })
    expect(rejected.isError).not.toBe(true)
    expect(answer(rejected)).toContain("Breaks your playbook")
    expect(posts).toHaveLength(0)
    const saved = await call("save_drafts", { title: "Release", drafts: [{ slotId, text: "CSV export is live." }], sourceKeys: [key] })
    expect(saved.isError).not.toBe(true)
    expect(answer(saved)).toContain("1 saved")
    expect(answer(saved)).toContain("Checked against")
    expect(posts).toHaveLength(1)
    const postId = posts[0].id
    const shown = answer(await call("show_next_week"))
    expect(shown).toContain(`post id ${postId}`)
    expect(shown).toContain("CSV export is live.")
    expect(answer(await call("list_new_material"))).not.toContain(`key: ${key}`)
    expect((await call("save_drafts", { title: "Repeat", drafts: [{ slotId, text: "again" }] })).isError).toBe(true)
    expect((await call("update_draft", { postId, text: "broth" })).isError).toBe(true)
    expect((await call("update_draft", { postId, text: "CSV export includes archived rows." })).isError).not.toBe(true)
    // The AI revising its own draft is the writer: its text becomes what Queue Pilot wrote, so it is never "your fix".
    expect((written.get("person-a") ?? []).filter((w) => w.postId === postId).at(-1)?.text).toBe("CSV export includes archived rows.")
    expect(answer(await call("show_next_week"))).toContain("includes archived rows")
    // The person then fixes the draft in Buffer, and asks the AI for another change: their fix must stay an edit.
    posts[0].text = "CSV export now includes archived rows."
    expect((await call("update_draft", { postId, text: "CSV export now includes archived rows too.", expectedText: "CSV export now includes archived rows." })).isError).not.toBe(true)
    const row = (written.get("person-a") ?? []).filter((w) => w.postId === postId).at(-1)
    expect(row?.text).toBe("CSV export includes archived rows.")
    expect(row?.checkedText).toBe("CSV export now includes archived rows too.")
    expect((await call("delete_draft", { postId })).isError).not.toBe(true)
    expect(lastAction("draft_deleted")).toMatchObject({ by: { via: "ai", app: "ChatGPT" }, facts: { ids: [postId] } })
    expect(answer(await call("show_next_week"))).not.toContain(`post id ${postId}`)
    expect(answer(await call("list_open_slots"))).toContain(slotId)
    expect(posts).toHaveLength(0)
  })

  it("refuses other apps' drafts and scheduled posts for both changes", async () => {
    setPosts([{ id: "foreign", channelId: "ch", status: "draft", via: "api", text: "Someone else's draft", dueAt: "2026-11-02T09:00:00.000Z", sentAt: null, externalLink: null, error: null }])
    for (const name of ["update_draft", "delete_draft"]) {
      expect((await call(name, { postId: "foreign", text: "replace" })).isError).toBe(true)
    }
    written.set("person-a", [{ postId: "foreign", network: "linkedin", text: "Original" }])
    posts[0].status = "scheduled"
    vi.setSystemTime(new Date("2026-10-29T12:01:00Z"))
    for (const name of ["update_draft", "delete_draft"]) {
      expect((await call(name, { postId: "foreign", text: "replace" })).isError).toBe(true)
      expect((await call(name, { postId: "foreign", text: "replace" }, "person-b")).isError).toBe(true)
    }
    expect(buffer.calls.filter((c) => /editPost|deletePost/.test(c.query))).toHaveLength(0)
  })

  it("keeps raw research private and makes it available to both writers", async () => {
    const input = { title: "Release notes", text: "CSV export includes archived rows.", link: "https://example.com/release" }
    const added = answer(await call("add_material", input))
    const key = added.match(/key: (.+)/)![1]
    expect(answer(await call("add_material", input))).toBe(added)
    expect(answer(await call("list_new_material"))).toContain(key)
    expect(answer(await call("read_material", { key }))).toContain(input.text)
    expect((await call("read_material", { key }, "person-b")).isError).toBe(true)
    expect(answer(await call("list_new_material", {}, "person-b"))).not.toContain(key)
    expect(await newMaterial("person-a")).toEqual([{ key, title: input.title, text: input.text, url: input.link }])
    const slotId = answer(await call("list_open_slots")).match(/ch@[^ ]+/)![0]
    await call("save_drafts", { title: input.title, drafts: [{ slotId, text: input.text }], sourceKeys: [key] })
    expect(answer(await call("list_new_material"))).not.toContain(key)
    expect(await newMaterial("person-a")).toEqual([])
    for (const bad of [{ ...input, text: "x".repeat(12_001) }, { ...input, title: " " }, { ...input, link: "file:///private/data" }]) {
      expect((await call("add_material", bad)).isError).toBe(true)
    }
  })
})

describe("connector controls", () => {
  it("adds a validated rule, exposes its ID, and rejects cross-user reads and removal", async () => {
    const input = { kind: "replace", from: "broth", to: "stock", channels: ["linkedin"], level: "block", userId: "person-b" };
    const added = JSON.parse(answer(await call("add_rule", input)));
    expect(added.id).toBeTruthy();
    expect(answer(await call("get_playbook"))).toContain(added.id);
    expect((await call("read_rule", { id: added.id }, "person-b")).isError).toBe(true);
    expect((await call("remove_rule", { id: added.id }, "person-b")).isError).toBe(true);
    expect(rules.get("person-a")).toHaveLength(1);
    expect((await call("add_rule", { ...input, channels: ["not-a-network"] })).isError).toBe(true);
    expect((await call("add_rule", { ...input, from: "" })).isError).toBe(true);
    await call("remove_rule", { id: added.id });
    expect(rules.get("person-a")).toHaveLength(0);
  });
  it("checks refusal, correction and warning without writing a Buffer post", async () => {
    rules.set("person-a", [{ id: "stock", kind: "replace", from: "broth", to: "stock", channels: "all", level: "block", text: "Say stock." }]);
    const bad = await call("check_draft", { text: "Use broth", network: "linkedin" });
    expect(bad.isError).not.toBe(true);
    expect(JSON.parse(answer(bad))).toMatchObject({ status: "refused", saved: false });
    expect(JSON.parse(answer(await call("check_draft", { text: "Use stock", network: "linkedin" })))).toMatchObject({ status: "passed", saved: false });
    rules.get("person-a")![0].level = "warn";
    expect(JSON.parse(answer(await call("check_draft", { text: "Use broth", network: "linkedin" })))).toMatchObject({ status: "flagged", saved: false });
    expect(aiCalls.settle).toHaveBeenCalledTimes(3);
    expect(posts).toHaveLength(0);
    expect(buffer.calls).toHaveLength(0);
    expect(JSON.parse(answer(await call("check_draft", { text: "Use stock", network: "linkedin" }, "person-b"))).status).toBe("not_checked");
  });
  it("fills a template from the source, spends nothing while a placeholder is empty, and checks the result with the playbook", async () => {
    rules.set("person-a", [{ id: "stock", kind: "replace", from: "broth", to: "stock", channels: "all", level: "block", text: "Say stock." }]);
    libFake.snippets = [{ id: "sn-1", name: "Soup", text: "#soup" }]
    try {
      const half = JSON.parse(answer(await call("fill_post_template", { templateId: "tpl-0", values: { feature: "broth packs" }, network: "linkedin" })))
      expect(half).toMatchObject({ status: "needs_values", missing: ["link"], saved: false })
      expect(aiCalls.settle).not.toHaveBeenCalled()
      const refused = JSON.parse(answer(await call("fill_post_template", { templateId: "tpl-0", values: { feature: "broth packs", link: "https://x.example/41" }, network: "linkedin" })))
      expect(refused).toMatchObject({ status: "refused", saved: false, text: "Shipped broth packs. https://x.example/41", template: "Release 0" })
      const passed = JSON.parse(answer(await call("fill_post_template", { templateId: "tpl-0", values: { feature: "stock packs", link: "https://x.example/41" }, network: "linkedin", snippetId: "sn-1" })))
      expect(passed).toMatchObject({ status: "passed", text: "Shipped stock packs. https://x.example/41\n\n#soup" })
      expect((await call("fill_post_template", { templateId: "nope", values: {}, network: "linkedin" })).isError).toBe(true)
      // A snippet the person found on a later page is still found, never called missing.
      // 450 sets at 100 a page: one read takes 300, so set 420 sits beyond the first batch.
      libFake.snippets = Array.from({ length: 450 }, (_, i) => ({ id: `sn-${i + 1}`, name: `Set ${i + 1}`, text: `#tag${i + 1}` }))
      const later = JSON.parse(answer(await call("fill_post_template", { templateId: "tpl-0", values: { feature: "stock packs", link: "https://x.example/41" }, network: "linkedin", snippetId: "sn-420" })))
      expect(later).toMatchObject({ status: "passed", text: "Shipped stock packs. https://x.example/41\n\n#tag420" })
      expect(posts).toHaveLength(0)
      expect(buffer.calls.some((c) => /createContentItem|createPost|editPost/.test(c.query))).toBe(false)
    } finally {
      libFake.snippets = []; libFake.snippetPage = 100
    }
  });
  it("counts length the way Buffer counts it for the network, not raw characters", async () => {
    // An X post with a long link: the link counts as 23, so 250 letters plus the link fit in 280.
    const xPost = `${"a".repeat(250)} https://example.com/${"p".repeat(300)}`
    expect(JSON.parse(answer(await call("check_draft", { text: xPost, network: "twitter" }))).status).not.toBe("refused")
    // Instagram counts each line break twice: 2180 letters with 10 line breaks inside count 2200, over 2196.
    const ig = `${"a".repeat(1090)}${"\n".repeat(10)}${"a".repeat(1090)}`
    expect(JSON.parse(answer(await call("check_draft", { text: ig, network: "instagram" })))).toMatchObject({ status: "refused" })
    // check_draft trims its input, so line breaks at the very end are not counted and the same letters fit.
    const trailing = `${"a".repeat(2180)}${"\n".repeat(10)}`
    expect(JSON.parse(answer(await call("check_draft", { text: trailing, network: "instagram" }))).status).not.toBe("refused")
  });
  it("returns a normal refusal for overlong text but keeps invalid tool inputs as errors", async () => {
    const overlong = await call("check_draft", { text: "x".repeat(281), network: "twitter" });
    expect(overlong.isError).not.toBe(true);
    expect(JSON.parse(answer(overlong))).toMatchObject({ status: "refused", saved: false });
    expect((await call("check_draft", { text: "", network: "twitter" })).isError).toBe(true);
    expect((await call("check_draft", { text: "A valid draft", network: "unsupported" })).isError).toBe(true);
    expect(aiCalls.settle).not.toHaveBeenCalled();
    expect(posts).toHaveLength(0);
    expect(buffer.calls).toHaveLength(0);
  });
  it("lists and removes only the token owner's sources", async () => {
    const a = await sources.add("person-a", "https://a.example/feed", "A");
    const b = await sources.add("person-b", "https://b.example/feed", "B");
    expect(answer(await call("list_sources"))).toContain(a.id);
    expect(answer(await call("list_sources"))).not.toContain(b.id);
    expect((await call("remove_source", { id: b.id, userId: "person-b" })).isError).toBe(true);
    await call("remove_source", { id: a.id });
    expect(await sources.list("person-a")).toHaveLength(0);
    expect(await sources.list("person-b")).toHaveLength(1);
  });
  it("reports the screen's true readiness and keeps human approval incomplete", async () => {
    expect(JSON.parse(answer(await call("get_setup_status")))).toMatchObject({ done: 2, total: 5 });
    await voices.addExample("person-a", { postId: "sample", channel: "Pasted", text: "Shipped this." });
    expect(JSON.parse(answer(await call("get_setup_status"))).done).toBe(3);
    await sources.add("person-a", "https://a.example/feed", "A");
    const status = JSON.parse(answer(await call("get_setup_status")));
    expect(status.done).toBe(4);
    expect(status.steps.find((s: { id: string }) => s.id === "approve").state).toBe("todo");
    expect(JSON.parse(answer(await call("get_setup_status", {}, "person-b"))).done).toBe(2);
    // The last step completes only once an approval of a Queue Pilot draft is on record for this person.
    written.set("person-a", [{ postId: "p1", network: "linkedin", text: "Shipped.", approvedBy: "app", approvedAt: "2026-11-09T10:00:00.000Z" }]);
    const after = JSON.parse(answer(await call("get_setup_status")));
    expect(after.steps.find((s: { id: string }) => s.id === "approve").state).toBe("done");
    expect(JSON.parse(answer(await call("get_setup_status", {}, "person-b"))).steps.find((s: { id: string }) => s.id === "approve").state).toBe("todo");
  });
  it("lets an AI see the person has no rules of their own while only the starting rule is there", async () => {
    await ruleStore.add("person-a", { ...(await import("@/lib/starting-rule")).STARTING_RULE })
    const playbook = answer(await call("get_playbook"))
    expect(playbook).toContain("No rules of the user's own yet")
    expect(playbook).toContain("Keep private matters private")
    expect(JSON.parse(answer(await call("get_setup_status"))).playbook).toEqual({ ownRules: 0, startingRule: true })
    await call("add_rule", { kind: "guidance", text: "Name the number first.", channels: "all", level: "warn" })
    expect(answer(await call("get_playbook"))).not.toContain("No rules of the user's own yet")
    expect(JSON.parse(answer(await call("get_setup_status"))).playbook).toEqual({ ownRules: 1, startingRule: true })
  });
  it("keeps and dismisses signed suggestions with tenant isolation and stored evidence", async () => {
    const { signSuggestion } = await import("@/lib/rule-suggestions");
    const token = signSuggestion("person-a", { key: "first:test", rule: { kind: "guidance", text: "Use short sentences.", channels: "all", level: "warn" }, fixes: 2, evidence: [{ before: "Long", after: "Short" }] });
    expect((await call("keep_suggestion", { token }, "person-b")).isError).toBe(true);
    expect((await call("dismiss_suggestion", { token }, "person-b")).isError).toBe(true);
    const r = JSON.parse(answer(await call("keep_suggestion", { token })));
    expect(r.ok).toBe(true);
    expect(answer(await call("read_rule", { id: r.id }))).toContain('"before": "Long"');
    await call("keep_suggestion", { token });
    expect(rules.get("person-a")).toHaveLength(1);
    await call("dismiss_suggestion", { token });
    expect(dismissed.get("person-a")?.has("first:test")).toBe(true);
    expect((await call("keep_suggestion", { token })).isError).toBe(true);
  });
  it("runs the built-in writer through real playbook refusal, retry, Buffer draft saves and readback", async () => {
    const writer = await import("@/lib/ai-writer");
    const draftWriter = vi.spyOn(writer, "writeDrafts").mockImplementation(async (_model, brief) => brief.slots.map(s => ({ slotId: s.id, text: brief.retry ? "Use stock for this recipe." : "Use broth for this recipe.", sourceKey: brief.material[0].key })));
    try {
      rules.set("person-a", [{ id: "stock", kind: "replace", from: "broth", to: "stock", channels: "all", level: "block", text: "Say stock." }]);
      await material.add("person-a", { title: "Recipe", text: "Use stock for this recipe." });
      const r = await call("write_my_week", { userId: "person-b" });
      expect(r.isError).not.toBe(true);
      expect(JSON.parse(answer(r))).toMatchObject({ ok: true, retried: 2, refused: [] });
      expect(posts).toHaveLength(2);
      expect(posts.every(p => p.status === "draft" && p.text.includes("stock"))).toBe(true);
      expect(draftWriter).toHaveBeenCalledTimes(2);
      expect(aiCalls.settle).toHaveBeenCalledTimes(1);
      const drafts = JSON.parse(answer(await call("list_my_drafts"))).drafts;
      expect(drafts).toHaveLength(2);
      expect(drafts[0].verdicts[0].verdict).toBe("pass");
      expect(JSON.parse(answer(await call("list_my_drafts", {}, "person-b"))).drafts).toHaveLength(0);
      posts[0].text = "Manually changed";
      vi.setSystemTime(new Date("2026-10-29T12:02:00Z"));
      await call("refresh_buffer");
      expect(JSON.parse(answer(await call("list_my_drafts"))).drafts[0]).toMatchObject({ changedSinceCheck: true, verdicts: null });
      expect(buffer.calls.some(c => /schedulePost|publishPost/.test(c.query))).toBe(false);
    } finally { draftWriter.mockRestore(); }
  });
  it("lists owned drafts even when Buffer reports via=buffer, excluding other apps and scheduled posts", async () => {
    setPosts(["ours", "foreign", "scheduled"].map(id => ({ id, channelId: "ch", status: id === "scheduled" ? "scheduled" : "draft", via: "buffer", text: "A useful release for builders.", dueAt: "2026-11-02T09:00:00.000Z", sentAt: null, externalLink: null, error: null } as Post)));
    written.set("person-a", [{ postId: "ours", text: posts[0].text!, network: "twitter" }, { postId: "scheduled", text: posts[2].text!, network: "twitter" }]);
    written.set("person-b", [{ postId: "foreign", text: posts[1].text!, network: "twitter" }]);
    const result = JSON.parse(answer(await call("list_my_drafts")));
    expect(result.drafts.map((p: { postId: string }) => p.postId)).toEqual(["ours"]);
  });
  it("gives back the AI action when the built-in writer has no material", async () => {
    const r = await call("write_my_week");
    expect(r.isError).toBe(true);
    expect(answer(r)).toContain("Nothing new to write from");
    expect(aiCalls.giveBack).toHaveBeenCalledTimes(1);
    expect(aiCalls.settle).toHaveBeenCalledTimes(1);
    expect(posts).toHaveLength(0);
  });
  it("hides storage failures from new controls", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const fail = vi.spyOn(ruleStore, "list").mockRejectedValue(new Error("private person-a SQL details"));
    try {
      const r = await call("read_rule", { id: "secret" });
      expect(r.isError).toBe(true);
      expect(answer(r)).not.toMatch(/person-a|SQL|secret/);
    } finally { fail.mockRestore(); log.mockRestore(); }
  });
});

describe("typed results proven in this file", () => {
  it("returns typed data from every tool this file proves", () => {
    expect(TOOL_OWNERS["drafts-and-controls"].filter((tool) => !typedSuccess.has(tool))).toEqual([])
  })
})
