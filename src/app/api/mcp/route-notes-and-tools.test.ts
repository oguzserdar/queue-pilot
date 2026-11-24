/**
 * @fileoverview MCP route: tag and note edits, typed results, tool hints and the writing examples.
 * Shared mocks, fakes and helpers: src/test/mcp-route-setup.ts and src/test/fake-buffer-api.ts.
 */
import { MAX_EXAMPLES, MAX_NOTE, MAX_PASTED_TEXT, POST, UNTYPED_TOOLS_LEFT, answer, buffer, call, lastAction, material, memorySnapshotStore, outcome, rpc, setSnapshots, typedSuccess, voices, written } from "@/test/mcp-route-setup"
import { TOOL_OWNERS } from "@/test/mcp-tool-owners"
import { channel, itemsFake, notesFake, posts, setPosts, tagsFake } from "@/test/fake-buffer-api"
import { describe, expect, it, vi } from "vitest"
import { BUFFER_ONLY_NOTE } from "@/lib/buffer-routing"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import type { Post } from "@/lib/buffer/queries"
import type { Written } from "@/lib/written-store"

describe("connector voice writes", () => {
  it("renames, recolors and deletes tags by exact name, refusing locked tags and duplicates", async () => {
    tagsFake.tags = [{ id: "t1", name: "Soups", color: "#8F2457", isLocked: false }, { id: "t2", name: "Stews", color: "#111111", isLocked: false }, { id: "t3", name: "Old", color: "#222222", isLocked: true }]
    try {
      expect((await call("rename_tag", { tag: "Soups" })).isError).toBe(true)
      expect(answer(await call("rename_tag", { tag: "soups", name: "Soup" }))).toContain("no tag with that exact name")
      expect(answer(await call("rename_tag", { tag: "Old", name: "New" }))).toContain("locked")
      expect(answer(await call("rename_tag", { tag: "Soups", name: "Stews" }))).toContain("exact name exists")
      expect(answer(await call("rename_tag", { tag: "Soups", name: "Soup week" }))).toContain('Tag "Soups" is now "Soup week" (#8F2457)')
      expect(answer(await call("rename_tag", { tag: "Stews", color: "#00AA00" }))).toContain('"Stews" (#00AA00)')
      expect(answer(await call("delete_tag", { tag: "Old" }))).toContain('Tag "Old" deleted')
      expect(lastAction("tag_deleted")).toMatchObject({ by: { via: "ai", app: "ChatGPT" }, facts: { name: "Old" } })
      expect(tagsFake.tags.map((t) => t.name)).toEqual(["Soup week", "Stews"])
      expect((await call("delete_tag", { tag: "Old" })).isError).toBe(true)
    } finally {
      tagsFake.tags = []
    }
  });
  it("mentions only teammates who can read notes on the post's channel, and only where the note names them", async () => {
    const draft: Post = { id: "mine", channelId: channel.id, text: "Draft", dueAt: "2026-11-09T09:00:00Z", status: "draft", via: "api", sentAt: null, externalLink: null, error: null } as Post
    setPosts([draft])
    written.set("person-a", [{ postId: "mine" } as Written])
    try {
      expect(answer(await call("add_draft_note", { postId: "mine", text: "Please check this", mention: ["acc-1"] }))).toContain("write each mention into the note first: @Sara")
      expect(answer(await call("add_draft_note", { postId: "mine", text: "@Sara please check", mention: ["acc-9"] }))).toContain("cannot be mentioned on this channel: acc-9")
      expect(notesFake.notes).toHaveLength(0)
      expect((await call("add_draft_note", { postId: "mine", text: "Thanks @Sara, checked.", mention: ["acc-1"] })).isError).not.toBe(true)
      expect(notesFake.annotations.at(-1)).toEqual([{ type: "mention", content: "@Sara", text: "@Sara", displayValue: "Sara", serviceEntityId: "urn:buffer:account:acc-1", indices: [7, 12] }])
      // Teammates come from the post's own channel, whether read alone or together with the live post.
      const teamRead = buffer.calls.find((c) => c.query.includes("selectableTeamMembers("))!
      expect((teamRead.variables.team ?? teamRead.variables.input)!.scope).toEqual({ channelId: channel.id })
    } finally {
      notesFake.notes = []; notesFake.annotations = []
    }
  });
  it("adds and reads notes on a channel-less draft's own thread, mentioning teammates of its organization", async () => {
    const draft = { id: "ci-note", organizationId: "org", title: null, targetDate: null, createdAt: "2026-11-05T00:00:00Z", allowedActions: [], tags: [], body: { __typename: "DraftContent", text: "One draft", aiAssisted: true, assets: [] } }
    itemsFake.items.set("ci-note", draft)
    itemsFake.items.set("ci-posts", { ...draft, id: "ci-posts", body: { __typename: "PostContent", posts: [] } })
    itemsFake.items.set("ci-other", { ...draft, id: "ci-other", organizationId: "someone-elses-org" })
    try {
      expect((await call("add_draft_note", { text: "x" })).isError).toBe(true)
      expect((await call("add_draft_note", { postId: "mine", contentItemId: "ci-note", text: "x" })).isError).toBe(true)
      expect(answer(await call("add_draft_note", { contentItemId: "ci-other", text: "x" }))).toContain("no content item with that id")
      expect(answer(await call("add_draft_note", { contentItemId: "ci-posts", text: "x" }))).toContain("already posts")
      expect(notesFake.notes).toHaveLength(0)
      const added = await call("add_draft_note", { contentItemId: "ci-note", text: "@Sara can you check the date?", mention: ["acc-1"] })
      expect(added.isError).not.toBe(true)
      expect(notesFake.notes.at(-1)).toMatchObject({ postId: "item:ci-note", node: { text: "@Sara can you check the date?" } })
      expect(notesFake.annotations.at(-1)).toEqual([{ type: "mention", content: "@Sara", text: "@Sara", displayValue: "Sara", serviceEntityId: "urn:buffer:account:acc-1", indices: [0, 5] }])
      expect(buffer.calls.filter((c) => c.query.includes("selectableTeamMembers(")).at(-1)?.variables.input!.scope).toEqual({ organizationId: "org" })
      expect(answer(await call("list_draft_notes", { contentItemId: "ci-note" }))).toContain("@Sara can you check the date?")
    } finally {
      notesFake.notes = []; notesFake.annotations = []; itemsFake.items.delete("ci-note"); itemsFake.items.delete("ci-posts"); itemsFake.items.delete("ci-other")
    }
  });
  it("edits only a note the person may edit, keeping mentions still named and adding new ones", async () => {
    const draft = (id: string): Post => ({ id, channelId: channel.id, text: `Draft ${id}`, dueAt: "2026-11-09T09:00:00Z", status: "draft", via: "api", sentAt: null, externalLink: null, error: null } as Post)
    setPosts([draft("mine"), draft("theirs")])
    const mine = { id: "n-mine", text: "@Sara please check the date", authorId: "me", author: { id: "me", name: "Me" }, annotations: [{ type: "mention", text: "@Sara", indices: [0, 5], displayValue: "Sara", serviceEntityId: "urn:buffer:account:acc-1" }], allowedActions: ["updateNote", "deleteNote"], createdAt: "2026-11-04T09:00:00Z", updatedAt: "2026-11-04T09:00:00Z" }
    const sara = { id: "n-sara", text: "Use the new photo", authorId: "a1", author: { id: "a1", name: "Sara" }, allowedActions: [], createdAt: "2026-11-03T10:00:00Z", updatedAt: "2026-11-03T10:00:00Z" }
    notesFake.notes = [{ postId: "theirs", node: mine }, { postId: "theirs", node: sara }]
    try {
      expect(answer(await call("list_draft_notes", { postId: "theirs" }))).toContain("[note n-mine; the person may edit or delete it] Me")
      expect((await call("update_draft_note", { noteId: "n-mine", text: "x" })).isError).toBe(true)
      const notOwn = await call("update_draft_note", { postId: "theirs", noteId: "n-sara", text: "Changed" })
      expect(notOwn.isError).toBe(true)
      expect(answer(notOwn)).toContain("only notes the person may edit")
      expect(answer(await call("update_draft_note", { postId: "mine", noteId: "n-mine", text: "x" }))).toContain("no note with that id on this post")
      expect(answer(await call("update_draft_note", { postId: "theirs", noteId: "n-mine", text: "Thanks", mention: ["acc-9"] }))).toContain("cannot be mentioned on this channel: acc-9")
      expect(notesFake.writes).toEqual([])
      // The saved @Sara stays where the text still names her, at its new place.
      expect((await call("update_draft_note", { postId: "theirs", noteId: "n-mine", text: "Thanks @Sara, date fixed" })).isError).not.toBe(true)
      expect(notesFake.writes.at(-1)).toMatchObject({ kind: "update", noteId: "n-mine", text: "Thanks @Sara, date fixed", annotations: [{ type: "mention", text: "@Sara", serviceEntityId: "urn:buffer:account:acc-1", indices: [7, 12] }] })
      // Removing the name drops the mention; a new mention must be written into the text.
      await call("update_draft_note", { postId: "theirs", noteId: "n-mine", text: "Date fixed" })
      expect(notesFake.writes.at(-1)?.annotations).toEqual([])
      expect(answer(await call("update_draft_note", { postId: "theirs", noteId: "n-mine", text: "Date fixed", mention: ["acc-1"] }))).toContain("write each mention into the note first: @Sara")
      await call("update_draft_note", { postId: "theirs", noteId: "n-mine", text: "Date fixed, @Sara", mention: ["acc-1"] })
      expect(notesFake.writes.at(-1)?.annotations).toEqual([{ type: "mention", content: "@Sara", text: "@Sara", displayValue: "Sara", serviceEntityId: "urn:buffer:account:acc-1", indices: [12, 17] }])
      notesFake.refuseUpdate = "InvalidInputError"
      const refused = await call("update_draft_note", { postId: "theirs", noteId: "n-mine", text: "Again @Sara", mention: ["acc-1"] })
      expect(refused.isError).toBe(true)
      expect(answer(refused)).toContain("a mentioned teammate cannot see this post")
    } finally {
      notesFake.notes = []; notesFake.writes = []; notesFake.refuseUpdate = ""
    }
  });
  it("edits a note on a channel-less draft's own thread", async () => {
    const item = { id: "ci-edit", organizationId: "org", title: null, targetDate: null, createdAt: "2026-11-05T00:00:00Z", allowedActions: [], tags: [], body: { __typename: "DraftContent", text: "One draft", aiAssisted: true, assets: [] } }
    itemsFake.items.set("ci-edit", item)
    notesFake.notes = [{ postId: "item:ci-edit", node: { id: "n-item", text: "Check the date", authorId: "me", author: { id: "me", name: "Me" }, allowedActions: ["updateNote", "deleteNote"], createdAt: "2026-11-04T09:00:00Z", updatedAt: "2026-11-04T09:00:00Z" } }]
    try {
      expect(answer(await call("update_draft_note", { contentItemId: "ci-missing", noteId: "n-item", text: "x" }))).toContain("no content item with that id")
      const r = await call("update_draft_note", { contentItemId: "ci-edit", noteId: "n-item", text: "@Sara, date checked", mention: ["acc-1"] })
      expect(r.isError).not.toBe(true)
      expect(answer(r)).toContain("Note changed")
      expect(notesFake.writes.at(-1)).toMatchObject({ kind: "update", noteId: "n-item", text: "@Sara, date checked", annotations: [{ serviceEntityId: "urn:buffer:account:acc-1", indices: [0, 5] }] })
      expect(buffer.calls.filter((c) => c.query.includes("selectableTeamMembers(")).at(-1)?.variables.input!.scope).toEqual({ organizationId: "org" })
    } finally {
      notesFake.notes = []; notesFake.writes = []; itemsFake.items.delete("ci-edit")
    }
  });
  it("deletes only a note the person may delete, and records it without its text", async () => {
    setPosts([{ id: "theirs", channelId: channel.id, text: "Draft", dueAt: "2026-11-09T09:00:00Z", status: "draft", via: "api", sentAt: null, externalLink: null, error: null } as Post])
    notesFake.notes = [
      { postId: "theirs", node: { id: "n-mine", text: "Private thought", authorId: "me", author: { id: "me", name: "Me" }, allowedActions: ["updateNote", "deleteNote"], createdAt: "2026-11-04T09:00:00Z", updatedAt: "2026-11-04T09:00:00Z" } },
      { postId: "theirs", node: { id: "n-sara", text: "Use the new photo", authorId: "a1", author: { id: "a1", name: "Sara" }, allowedActions: [], createdAt: "2026-11-03T10:00:00Z", updatedAt: "2026-11-03T10:00:00Z" } },
    ]
    try {
      const notOwn = await call("delete_draft_note", { postId: "theirs", noteId: "n-sara" })
      expect(notOwn.isError).toBe(true)
      expect(answer(notOwn)).toContain("only notes the person may delete")
      expect(notesFake.writes).toEqual([])
      expect(lastAction("note_deleted")).toBeUndefined()
      expect(answer(await call("delete_draft_note", { postId: "theirs", noteId: "n-mine" }))).toContain("Note deleted")
      expect(notesFake.writes).toEqual([{ kind: "delete", noteId: "n-mine" }])
      expect(notesFake.notes.map((n) => n.node.id)).toEqual(["n-sara"])
      expect(lastAction("note_deleted")).toMatchObject({ by: { via: "ai", app: "ChatGPT" }, facts: { ids: ["n-mine"] } })
      expect(JSON.stringify(lastAction("note_deleted"))).not.toContain("Private thought")
      expect((await call("delete_draft_note", { postId: "theirs", noteId: "n-mine" })).isError).toBe(true)
    } finally {
      notesFake.notes = []; notesFake.writes = []
    }
  });
  it("reports each channel's daily posting limit and Buffer's request allowance", async () => {
    const r = answer(await call("get_buffer_limits"))
    expect(r).toContain("Daily posting limits right now:")
    expect(r).toContain("- My channel (linkedin): no daily limit (0 counted now).")
    expect(r).toMatch(/Buffer requests left|did not report its request allowance/)
  });
  it("says in the week view when a channel's queue is paused in Buffer", async () => {
    expect(answer(await call("show_next_week"))).not.toContain("paused")
    channel.isQueuePaused = true
    setSnapshots(memorySnapshotStore()) // a fresh read of Buffer, not the copy saved a moment ago
    try {
      expect(answer(await call("show_next_week"))).toContain("My channel's queue is paused in Buffer, so its scheduled posts will not go out")
    } finally {
      channel.isQueuePaused = false
    }
  });
  it("lists all tools with serializable input schemas", async () => {
    const response = await rpc("tools/list", {})
    expect(response.error).toBeUndefined()
    const tools = response.result.tools
    expect(tools).toHaveLength(83)
    expect(tools.map((t: { name: string }) => t.name)).toEqual(expect.arrayContaining(["share_for_review", "list_review_comments", "turn_off_review", "propose_rule_fixes"]))
    expect(tools.map((t: { name: string }) => t.name)).not.toEqual(expect.arrayContaining(["approve", "schedule", "delete_account", "save_ai_key"]))
    expect(tools.find((t: { name: string }) => t.name === "add_voice_example").inputSchema.properties.text.maxLength).toBe(MAX_PASTED_TEXT)
    expect(tools.find((t: { name: string }) => t.name === "save_my_voice_note").inputSchema.properties.note.maxLength).toBe(MAX_NOTE)
  })

  // Typed results (MCP 2026-07-28): the SDK rejects a normal result without structured content from a tool that declares
  // an output schema, so tools are converted a whole file at a time. This number only goes down; lower it with each one.
  it("answers last week's delivery with typed data", async () => {
    const r = await call("show_last_week_delivery")
    expect(outcome(r)).toEqual({ isError: false, answer: expect.any(String) })
    expect(r.structuredContent).toMatchObject({ asOf: expect.any(String), posts: expect.any(Array) })
  })

  it("lists the sources behind waiting drafts as typed data", async () => {
    const r = await call("list_sources_to_check")
    expect(outcome(r)).toEqual({ isError: false, answer: expect.any(String) })
    expect(r.structuredContent).toMatchObject({ sources: expect.any(Array) })
  })

  it("answers the rule-scope writes with typed data", async () => {
    const inherit = await call("set_rule_inheritance", { target: { level: "network", id: "linkedin" }, shared: false })
    expect(outcome(inherit)).toEqual({ isError: false, answer: expect.any(String) })
    expect(inherit.structuredContent).toEqual({ ok: true })
    const override = await call("set_rule_override", { ruleId: "r1", target: { level: "account", id: "ch-1" }, value: true })
    expect(outcome(override)).toEqual({ isError: false, answer: expect.any(String) })
    expect(override.structuredContent).toEqual({ ok: true })
  })

  it("takes a scheduled post this app wrote off the schedule, and refuses one it did not write", async () => {
    const scheduled = (id: string): Post => ({ id, channelId: "ch", text: `Post ${id}`, dueAt: "2026-11-09T09:00:00Z", status: "scheduled", via: "api", sentAt: null, externalLink: null, error: null } as unknown as Post)
    setPosts([scheduled("mine"), scheduled("theirs")])
    written.set("person-a", [{ postId: "mine" } as Written])
    const theirs = await call("move_back_to_draft", { postId: "theirs" })
    expect(theirs.isError).toBe(true)
    expect(posts.find((p) => p.id === "theirs")?.status).toBe("scheduled")
    const mine = await call("move_back_to_draft", { postId: "mine" })
    expect(outcome(mine)).toEqual({ isError: false, answer: expect.any(String) })
    expect(mine.structuredContent).toEqual({ postId: "mine", status: "draft" })
    expect(posts.find((p) => p.id === "mine")?.status).toBe("draft")
    written.delete("person-a")
  })

  it("gives every tool typed results (an output schema), so no tool answers with text alone", async () => {
    const tools = (await rpc("tools/list", {})).result.tools as { name: string; outputSchema?: { type?: string } }[]
    const untyped = tools.filter((t) => !t.outputSchema).map((t) => t.name)
    expect(untyped.length).toBeLessThanOrEqual(UNTYPED_TOOLS_LEFT)
    // Every tool now has typed results; the list names any that ever loses them.
    expect(untyped).toEqual([])
    for (const t of tools.filter((x) => x.outputSchema)) expect(t.outputSchema?.type).toBe("object")
  })

  it("marks only plain-Buffer tools as routable through Buffer's own connector, never QP's checked drafting", async () => {
    const tools = (await rpc("tools/list", {})).result.tools as { name: string; description?: string }[]
    const noted = tools.filter((t) => t.description?.endsWith(BUFFER_ONLY_NOTE)).map((t) => t.name).sort()
    expect(noted).toEqual(["create_tag", "delete_content_item", "delete_snippet", "delete_tag", "get_channel_settings", "get_content_item", "get_post_template", "link_post_to_content_item", "list_buffer_ideas", "list_content_items", "list_post_templates", "list_snippets", "list_tags", "list_team_members", "rename_tag", "save_idea", "save_snippet", "unlink_post_from_content_item", "update_content_item"])
    for (const core of ["save_drafts", "update_draft", "check_draft", "fill_post_template", "save_channel_less_draft", "promote_to_draft_posts", "add_draft_note", "tag_draft", "get_playbook", "get_my_voice", "read_material"]) {
      expect({ core, mentionsConnector: tools.find((t) => t.name === core)?.description?.includes("official connector") }).toEqual({ core, mentionsConnector: false })
    }
  })

  it("declares honest MCP hints on every one of the 76 tools as clients receive them", async () => {
    const tools = (await rpc("tools/list", {})).result.tools as { name: string; title?: string; description?: string; annotations?: Record<string, unknown> }[]
    // Control: the answer includes tools from all three registration modules.
    expect(tools.map((t) => t.name)).toEqual(expect.arrayContaining(["show_next_week", "check_draft", "promote_to_draft_posts"]))
    for (const t of tools) {
      expect(typeof t.title === "string" && t.title.length > 0, `${t.name} title`).toBe(true)
      expect(typeof t.description === "string" && t.description.length > 0, `${t.name} description`).toBe(true)
      for (const h of ["readOnlyHint", "destructiveHint", "openWorldHint"]) expect(typeof t.annotations?.[h], `${t.name} ${h}`).toBe("boolean")
    }
    // Every Buffer write, including the content-item writes, is marked as reaching outside and not read-only.
    const bufferWrites = ["save_drafts", "write_my_week", "update_draft", "delete_draft", "approve_drafts", "add_draft_note", "update_draft_note", "delete_draft_note", "save_idea", "create_tag", "tag_draft", "save_snippet", "delete_snippet", "rename_tag", "delete_tag",
      "save_channel_less_draft", "promote_to_draft_posts", "update_content_item", "delete_content_item", "link_post_to_content_item", "unlink_post_from_content_item"]
    for (const name of bufferWrites) {
      const t = tools.find((x) => x.name === name)
      expect({ name, annotations: t?.annotations }).toMatchObject({ name, annotations: { readOnlyHint: false, openWorldHint: true } })
    }
    // The write-tools doc promises a row for every Buffer write, so a write tool with no row fails here.
    const writeDoc = readFileSync(join(__dirname, "../../../..", "docs/agent-write-tools.md"), "utf8")
    for (const name of bufferWrites) expect(writeDoc.includes(`\`${name}\``), `${name} has a row in docs/agent-write-tools.md`).toBe(true)
    for (const name of ["delete_draft", "delete_draft_note", "delete_snippet", "delete_tag", "delete_content_item"]) expect({ name, annotations: tools.find((x) => x.name === name)?.annotations }).toMatchObject({ name, annotations: { destructiveHint: true } })
  })

  it("saves, reads and clears notes only for the token's person", async () => {
    expect(answer(await call("save_my_voice_note", { note: "Short and plain", userId: "person-b" }))).toContain("saved")
    expect(answer(await call("get_my_voice"))).toContain("Short and plain")
    expect(answer(await call("get_my_voice", {}, "person-b"))).toContain("No voice set")
    expect((await call("save_my_voice_note", { note: "x".repeat(MAX_NOTE + 1) })).isError).toBe(true)
    expect((await voices.get("person-a")).note).toBe("Short and plain")
    expect((await call("save_my_voice_note", { note: "x".repeat(MAX_NOTE) })).isError).not.toBe(true)
    await call("save_my_voice_note", { note: "" })
    expect((await voices.get("person-a")).note).toBeNull()
  })

  it("removes only the requested example owned by the token's person", async () => {
    await voices.setNote("person-a", "Keep this note")
    await voices.addExample("person-a", { postId: "a-1", channel: "Pasted", text: "First" })
    await voices.addExample("person-a", { postId: "a-2", channel: "Pasted", text: "Second" })
    await voices.addExample("person-b", { postId: "b-1", channel: "Pasted", text: "Private" })
    expect(answer(await call("get_my_voice"))).toContain('Example ID: "a-1"')
    expect(answer(await call("get_my_voice"))).not.toContain("b-1")
    await call("remove_voice_example", { exampleId: "b-1", userId: "person-b" })
    expect((await voices.get("person-b")).examples).toHaveLength(1)
    expect(answer(await call("remove_voice_example", { exampleId: "a-1" }))).toContain("removed")
    expect(await voices.get("person-a")).toEqual({ note: "Keep this note", examples: [{ postId: "a-2", channel: "Pasted", text: "Second" }] })
    await call("remove_voice_example", { exampleId: "a-1" })
    expect((await voices.get("person-a")).examples).toHaveLength(1)
    expect(buffer.calls).toHaveLength(0)
  })

  it("hides storage failures when removing a writing example", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {})
    await voices.addExample("person-a", { postId: "a-1", channel: "Pasted", text: "First" })
    vi.spyOn(voices, "removeExample").mockRejectedValue(new Error("private person-a SQL failure"))
    const result = await call("remove_voice_example", { exampleId: "a-1" })
    expect(result.isError).toBe(true)
    expect(answer(result)).toBe("Could not remove that example just now. Try again in a minute.")
    log.mockRestore()
  })

  it("saves pasted posts and refuses blank, long or excess examples", async () => {
    expect((await call("add_voice_example", { text: "x".repeat(MAX_PASTED_TEXT + 1) })).isError).toBe(true)
    expect((await call("add_voice_example", { text: "\u200b " })).isError).toBe(true)
    expect((await call("add_voice_example", { text: "x".repeat(MAX_PASTED_TEXT), userId: "person-b" })).isError).not.toBe(true)
    for (let i = 1; i < MAX_EXAMPLES; i++) await call("add_voice_example", { text: `My post ${i}` })
    expect(answer(await call("get_my_voice"))).toContain('channel="Added by ChatGPT"')
    expect((await voices.get("person-b")).examples).toEqual([])
    const result = await call("add_voice_example", { text: "one more" })
    expect(result.isError).toBe(true)
    expect(answer(result)).toContain("Remove one")
  })

  it.each(["save_my_voice_note", "add_voice_example", "add_material"])("hides private failures from %s", async (name) => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {})
    const fail = new Error("private person-a storage failure")
    vi.spyOn(voices, "setNote").mockRejectedValue(fail)
    vi.spyOn(voices, "addExample").mockRejectedValue(fail)
    vi.spyOn(material, "add").mockRejectedValue(fail)
    const result = await call(name, { note: "short", text: "My writing", title: "Notes" })
    expect(result.isError).toBe(true)
    expect(answer(result)).toBe("Could not save that just now. Try again in a minute.")
    log.mockRestore()
  })

  it("rejects signed-out requests before a tool writes", async () => {
    const res = await POST(new Request("https://app.example/api/mcp", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "add_voice_example", arguments: { text: "My post" } } }) }))
    expect(res.status).toBe(401)
    expect((await voices.get("person-a")).examples).toEqual([])
  })
})

describe("typed results proven in this file", () => {
  it("returns typed data from every tool this file proves", () => {
    expect(TOOL_OWNERS["notes-and-tools"].filter((tool) => !typedSuccess.has(tool))).toEqual([])
  })
})
