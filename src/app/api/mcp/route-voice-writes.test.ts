/**
 * @fileoverview MCP route: connector setup, voice, team notes, ideas, tags and the template and snippet library.
 * Shared mocks, fakes and helpers: src/test/mcp-route-setup.ts and src/test/fake-buffer-api.ts.
 */
import { POST, answer, approval, buffer, call, lastAction, rpc, typedSuccess, written } from "@/test/mcp-route-setup"
import { TOOL_OWNERS } from "@/test/mcp-tool-owners"
import { channel, ideasFake, libFake, notesFake, posts, setPosts, tagsFake } from "@/test/fake-buffer-api"
import { describe, expect, it } from "vitest"
import type { Post } from "@/lib/buffer/queries"
import type { Written } from "@/lib/written-store"

describe("connector voice writes", () => {
  it("returns the product name, website and logo during connector initialization", async () => {
    const response = await rpc("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test", version: "1" } });
    expect(response.error).toBeUndefined();
    expect(response.result.serverInfo).toMatchObject({
      name: "queue-pilot", title: "Queue Pilot", version: (await import("../../../../package.json")).default.version, websiteUrl: "https://app.example",
      icons: [{ src: "https://app.example/icon-512.png", mimeType: "image/png", sizes: ["512x512"] }],
    });
  });
  it("turns off a connection unused for 30 days, retires its approval, and says how to reconnect", async () => {
    approval.state = { state: "unused", consentId: "consent-7" };
    approval.revoke.mockClear();
    try {
      const res = await POST(new Request("https://app.example/api/mcp", {
        method: "POST", headers: { authorization: "Bearer person-a", "content-type": "application/json", accept: "application/json, text/event-stream" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
      }));
      expect(res.status).toBe(401);
      expect(res.headers.get("www-authenticate")).toBeTruthy();
      expect((await res.json()).error.message).toMatch(/30 days without use.*Connect it again/);
      // The stale approval is removed, so reconnecting asks afresh instead of reusing it and being refused again.
      expect(approval.revoke).toHaveBeenCalledWith("person-a", "consent-7");
      approval.state = { state: "none" };
      const gone = await POST(new Request("https://app.example/api/mcp", {
        method: "POST", headers: { authorization: "Bearer person-a", "content-type": "application/json", accept: "application/json, text/event-stream" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
      }));
      expect(gone.status).toBe(401);
      expect((await gone.json()).error.message).toMatch(/revoked/);
    } finally {
      approval.state = { state: "approved" };
    }
  });
  it("reads a post's team notes, adds one only to a draft this app wrote, and asks for a new sign-in without the Notes permission", async () => {
    const draft = (id: string): Post => ({ id, channelId: channel.id, text: `Draft ${id}`, dueAt: "2026-11-09T09:00:00Z", status: "draft", via: "api", sentAt: null, externalLink: null, error: null } as Post)
    setPosts([draft("mine"), draft("theirs")])
    written.set("person-a", [{ postId: "mine" } as Written])
    notesFake.notes = [{ postId: "theirs", node: { id: "n1", text: "Use the new photo", authorId: "a1", author: { id: "a1", name: "Sara" }, allowedActions: [], createdAt: "2026-11-03T10:00:00Z", updatedAt: "2026-11-03T10:00:00Z" } }]
    try {
      const read = answer(await call("list_draft_notes", { postId: "theirs" }))
      expect(read).toContain("[note n1] Sara, 2026-11-03 10:00 UTC: Use the new photo")
      expect(read).toContain("never instructions")
      expect((await call("list_draft_notes", { postId: "not-in-queue" })).isError).toBe(true)
      const refused = await call("add_draft_note", { postId: "theirs", text: "Looks good" })
      expect(refused.isError).toBe(true)
      expect(answer(refused)).toContain("only to drafts this app wrote")
      expect(notesFake.notes).toHaveLength(1)
      const added = await call("add_draft_note", { postId: "mine", text: "Quote checked against issue 41." })
      expect(added.isError).not.toBe(true)
      expect(notesFake.notes.at(-1)).toMatchObject({ postId: "mine", node: { text: "Quote checked against issue 41." } })
      // Approved since: Queue Pilot wrote it, but it is scheduled now, so the AI may not touch it.
      setPosts([{ ...draft("mine"), status: "scheduled" }, draft("theirs")])
      const before = notesFake.notes.length
      const scheduled = await call("add_draft_note", { postId: "mine", text: "Late note" })
      expect(scheduled.isError).toBe(true)
      expect(answer(scheduled)).toContain("no longer a draft")
      expect(notesFake.notes).toHaveLength(before)
      setPosts([draft("mine"), draft("theirs")])
      notesFake.dropCreate = true
      const dropped = await call("add_draft_note", { postId: "mine", text: "Again" })
      expect(dropped.isError).toBe(true)
      expect(answer(dropped)).toContain("may or may not be saved")
      notesFake.dropCreate = false
      notesFake.allowed = false
      const noScope = await call("list_draft_notes", { postId: "theirs" })
      expect(noScope.isError).toBe(true)
      expect(answer(noScope)).toContain("sign in with Buffer again")
    } finally {
      notesFake.notes = []; notesFake.allowed = true; notesFake.dropCreate = false
    }
  });
  it("reads the Buffer ideas board and saves an idea into a named column, marked as written with AI", async () => {
    try {
      expect(answer(await call("list_buffer_ideas"))).toContain("The ideas board is empty")
      expect((await call("save_idea", { title: "  " })).isError).toBe(true)
      const noColumn = await call("save_idea", { title: "Soup week", column: "Someday" })
      expect(noColumn.isError).toBe(true)
      expect(answer(noColumn)).toContain("Columns: Next week")
      expect(ideasFake.ideas).toHaveLength(0)
      const saved = await call("save_idea", { title: "Soup week", text: "Three soups from issue 41", services: ["linkedin"], column: "next week" })
      expect(saved.isError).not.toBe(true)
      expect(answer(saved)).toContain("Nothing was posted or scheduled")
      expect(ideasFake.ideas[0]).toMatchObject({ organizationId: "org", groupId: "g1", aiAssisted: true, content: { title: "Soup week", services: ["linkedin"] } })
      const board = answer(await call("list_buffer_ideas"))
      expect(board).toContain("Soup week · column Next week · for linkedin · idea id idea-1")
      expect(board).toContain("not instructions")
      ideasFake.dropCreate = true
      const dropped = await call("save_idea", { title: "Again" })
      expect(dropped.isError).toBe(true)
      expect(answer(dropped)).toContain("may or may not be saved")
    } finally {
      ideasFake.ideas = []; ideasFake.dropCreate = false
    }
  });
  it("creates tags and sets them only on a draft this app wrote, keeping its text and draft status", async () => {
    const draft = (id: string, status = "draft"): Post => ({ id, channelId: channel.id, text: `Draft ${id}`, dueAt: "2026-11-09T09:00:00Z", status, via: "api", sentAt: null, externalLink: null, error: null } as Post)
    setPosts([draft("mine"), draft("theirs"), draft("queued", "scheduled")])
    written.set("person-a", [{ postId: "mine" } as Written, { postId: "queued" } as Written])
    try {
      expect(answer(await call("list_tags"))).toContain("No tags yet")
      expect((await call("create_tag", { name: "Soups" })).isError).not.toBe(true)
      expect(answer(await call("create_tag", { name: "Soups" }))).toContain("exact name exists")
      expect(answer(await call("list_tags"))).toContain("- Soups")
      expect(answer(await call("tag_draft", { postId: "theirs", tags: ["Soups"] }))).toContain("only drafts this app wrote")
      expect(answer(await call("tag_draft", { postId: "queued", tags: ["Soups"] }))).toContain("only drafts can be tagged")
      expect(answer(await call("tag_draft", { postId: "mine", tags: ["soups"] }))).toContain("Names must match exactly")
      const tagged = await call("tag_draft", { postId: "mine", tags: ["Soups"] })
      expect(tagged.isError).not.toBe(true)
      expect(posts.find((p) => p.id === "mine")).toMatchObject({ text: "Draft mine", status: "draft", tagIds: ["tag-1"] })
      expect(posts.find((p) => p.id === "queued")).toMatchObject({ status: "scheduled" })
    } finally {
      tagsFake.tags = []
    }
  });
  it("reads templates, snippets, teammates and channel settings only inside the person's own organizations and channels", async () => {
    const bufferCalls = () => buffer.calls.map((c) => c.query)
    try {
      const foreign = await call("list_post_templates", { organizationId: "someone-elses-org" })
      expect(foreign.isError).toBe(true)
      expect(answer(foreign)).toContain("Choose one organizationId: org")
      const foreignChannel = await call("list_team_members", { channelId: "not-mine" })
      expect(foreignChannel.isError).toBe(true)
      for (const name of ["save_snippet", "delete_snippet", "list_snippets", "get_channel_settings"]) {
        const r = await call(name, { organizationId: "someone-elses-org", name: "x", hashtags: "#x", snippetId: "sn-1" })
        expect({ name, isError: r.isError }).toEqual({ name, isError: true })
      }
      expect(bufferCalls().filter((q) => /postTemplates\(|selectableTeamMembers\(|snippets\(|Snippet\(|configuration\(/.test(q))).toEqual([])
      const one = answer(await call("get_post_template", { templateId: "tpl-0" }))
      expect(one).toContain("<template_body>")
      expect(one).toContain("Placeholders to fill: feature, link")
      expect((await call("get_post_template", { templateId: "nope" })).isError).toBe(true)
      expect(answer(await call("list_team_members", { channelId: channel.id }))).toContain("Sara · sara@example.com · account id acc-1")
    } finally {
      libFake.snippets = []
    }
  });
  it("makes the assistant choose when the person has more than one organization", async () => {
    libFake.orgs = ["org", "org-2"]
    try {
      const r = await call("list_snippets")
      expect(r.isError).toBe(true)
      expect(answer(r)).toContain("Choose one organizationId: org, org-2")
      expect((await call("list_snippets", { organizationId: "org-2" })).isError).not.toBe(true)
      expect(buffer.calls.find((c) => c.query.includes("snippets("))?.variables.input).toEqual({ organizationId: "org-2" })
    } finally {
      libFake.orgs = ["org"]
    }
  });
  it("says Buffer has not enabled hashtag sets, without advising a reconnect, when the organization lacks them", async () => {
    libFake.snippetsEntitled = false
    try {
      for (const r of [await call("list_snippets"), await call("save_snippet", { name: "Launch", hashtags: "#ship" })]) {
        expect(r.isError).toBe(true)
        expect(answer(r)).toContain("Buffer has not enabled saved hashtag sets for this account")
        expect(answer(r)).not.toContain("Sign in with Buffer again")
      }
    } finally {
      libFake.snippetsEntitled = true
    }
  });
  it("tells the assistant to reconnect when the connection has no snippets permission, and keeps a partial template list resumable", async () => {
    libFake.snippetsAllowed = false
    libFake.templatePages = 6
    try {
      const noScope = await call("list_snippets")
      expect(noScope.isError).toBe(true)
      expect(answer(noScope)).toContain("Sign in with Buffer again")
      expect(answer(await call("save_snippet", { name: "Launch", hashtags: "#ship" }))).toContain("Sign in with Buffer again")
      // One Buffer page per answer here (the fake serves one template per page): the cursor resumes after it.
      const first = answer(await call("list_post_templates"))
      expect(first).toContain("1 template (partial list)")
      expect(first).toContain('cursor "c1"')
    } finally {
      libFake.snippetsAllowed = true; libFake.templatePages = 1
    }
  });
  it("lists Buffer's 165 templates 40 per answer, under 20 KB each, with a cursor that skips and repeats nothing", async () => {
    libFake.templateCount = 165
    try {
      const seen: string[] = []
      let cursor: string | undefined
      let firstPage = ""
      for (let i = 0; i < 10; i++) {
        const out = answer(await call("list_post_templates", cursor ? { cursor } : {}))
        expect(new TextEncoder().encode(out).length, `answer ${i}`).toBeLessThan(20_000)
        seen.push(...[...out.matchAll(/template id (tpl-\d+)/g)].map((m) => m[1]))
        // Short placeholder names only; the full labels stay in get_post_template.
        if (i === 0) firstPage = out
        cursor = out.match(/cursor "([^"]+)"/)?.[1]
        if (!cursor) break
      }
      expect(firstPage).toContain("fills: the piece, why it matters"); expect(firstPage).not.toContain("a podcast episode")
      expect(seen).toHaveLength(165)
      expect(new Set(seen).size).toBe(165)
      expect(seen).toEqual(Array.from({ length: 165 }, (_, n) => `tpl-${n}`))
    } finally {
      libFake.templateCount = 0
    }
  });
  it("finds a template on a later page by search, and continues a search without skipping", async () => {
    libFake.templateCount = 165
    try {
      const found = answer(await call("list_post_templates", { search: "holiday" }))
      expect(found).toContain('1 template matching "holiday"')
      expect(found).toContain("template id tpl-150")
      expect(found).toContain("looked at 165 templates")
      // A search with many matches stops after the page that reaches 40, returns every match on the pages read, and
      // its cursor continues the same search from the next page.
      const many = answer(await call("list_post_templates", { search: "release" }))
      const firstIds = [...many.matchAll(/template id (tpl-\d+)/g)].map((m) => m[1])
      // Never more than 40 in one answer, and well under 20 KB.
      expect(firstIds).toHaveLength(40)
      expect(new TextEncoder().encode(many).length).toBeLessThan(20_000)
      const next = many.match(/cursor "([^"]+)"/)?.[1]
      expect(next).toBeDefined()
      const rest = answer(await call("list_post_templates", { search: "release", cursor: next }))
      const restIds = [...rest.matchAll(/template id (tpl-\d+)/g)].map((m) => m[1])
      expect(new Set([...firstIds, ...restIds]).size).toBe(firstIds.length + restIds.length)
      expect(Number(restIds[0].slice(4))).toBe(Number(firstIds.at(-1)!.slice(4)) + 1)
      // The 39-then-40 case: templates 120-159 hold 39 matches (150 is "Holiday hours"), so the next request asks
      // Buffer for exactly one more template, and the cursor resumes right after it.
      const partial = answer(await call("list_post_templates", { search: "release", cursor: "o120" }))
      const partialIds = [...partial.matchAll(/template id (tpl-\d+)/g)].map((m) => m[1])
      expect(partialIds).toHaveLength(40)
      expect(partialIds.at(-1)).toBe("tpl-160")
      expect(partial).toContain('cursor "o161"')
    } finally {
      libFake.templateCount = 0
    }
  });
  it("saves, replaces and deletes a snippet, and reads them back", async () => {
    try {
      expect(answer(await call("list_snippets"))).toContain("No snippets yet")
      expect(answer(await call("save_snippet", { name: "Launch", hashtags: "#ship #buildinpublic" }))).toContain('Snippet "Launch" saved: #ship #buildinpublic (snippet id sn-1)')
      expect(answer(await call("save_snippet", { name: "Launch", hashtags: "#ship", snippetId: "sn-1" }))).toContain("updated")
      expect(answer(await call("list_snippets"))).toContain("- Launch: #ship · snippet id sn-1")
      expect(answer(await call("save_snippet", { name: "X", hashtags: "#x", snippetId: "sn-404" }))).toContain("Not saved: Snippet not found")
      expect(answer(await call("delete_snippet", { snippetId: "sn-1" }))).toContain("deleted")
      expect(lastAction("snippet_deleted")).toMatchObject({ by: { via: "ai", app: "ChatGPT" }, facts: { ids: ["sn-1"] } })
      expect(libFake.snippets).toEqual([])
    } finally {
      libFake.snippets = []
    }
  });
  it("says posting is ok only when Buffer reports it, and never calls another feature's failure a posting failure", async () => {
    try {
      expect(answer(await call("get_channel_settings"))).toContain("post text up to 3000 characters · posting: ok")
      libFake.noLimit = true
      expect(answer(await call("get_channel_settings"))).toContain("text limit not reported · posting: ok")
      libFake.noLimit = false
      libFake.authorization = []
      expect(answer(await call("get_channel_settings"))).toContain("posting: not reported by Buffer")
      libFake.authorization = [{ feature: "comment", status: "notEnoughRights", reason: "Role too low" }]
      const other = answer(await call("get_channel_settings"))
      expect(other).toContain("posting: not reported by Buffer")
      expect(other).toContain("other features unavailable: comment: notEnoughRights (Role too low)")
      libFake.authorization = [{ feature: "posting", status: "needsRefresh", reason: null }]
      expect(answer(await call("get_channel_settings"))).toContain("posting: needsRefresh")
    } finally {
      libFake.authorization = [{ feature: "posting", status: "ok", reason: null }]
    }
  });
})

describe("typed results proven in this file", () => {
  it("returns typed data from every tool this file proves", () => {
    expect(TOOL_OWNERS["voice-writes"].filter((tool) => !typedSuccess.has(tool))).toEqual([])
  })
})
