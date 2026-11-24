/**
 * @fileoverview MCP route: content items, written once and posted to chosen accounts later.
 * Shared mocks, fakes and helpers: src/test/mcp-route-setup.ts and src/test/fake-buffer-api.ts.
 */
import { answer, attemptStore, call, lastAction, outcome, rules, typedSuccess, written } from "@/test/mcp-route-setup"
import { TOOL_OWNERS } from "@/test/mcp-tool-owners"
import { channel, itemsFake, libFake, posts, setPosts } from "@/test/fake-buffer-api"
import { afterEach, describe, expect, it, vi } from "vitest"
import { BufferApiError } from "@/lib/buffer/client"
import type { Channel } from "@/lib/buffer/queries"

describe("connector voice writes", () => {
  describe("content items: write once, choose accounts later", () => {
    const second: Channel = { ...channel, id: "ch2", name: "Second", service: "twitter" }
    const reset = () => { itemsFake.items.clear(); itemsFake.extraChannels = []; itemsFake.promote = "ok"; itemsFake.promotes = 0; itemsFake.dropCreate = false; itemsFake.createRefusal = ""; itemsFake.readFails = false; itemsFake.deleteThrows = false; itemsFake.reads = 0; itemsFake.attachOnRead = 0; attemptStore.store.rows.clear() }
    afterEach(reset)
    const saveDraft = async (text = "Soup night: three soups from issue 41.", requestId: string = crypto.randomUUID()) => call("save_channel_less_draft", { text, title: "Issue 41", requestId })

    it("saves one channel-less draft even when an unclear save is retried with the same requestId, and refuses a stale replace", async () => {
      expect(answer(await call("save_channel_less_draft", { text: "No id" }))).toContain("Pass requestId")
      expect(itemsFake.items.size).toBe(0)
      const id = crypto.randomUUID()
      itemsFake.dropCreate = true
      expect(answer(await saveDraft(undefined, id))).toContain(`Retry with requestId "${id}"`)
      const again = await saveDraft(undefined, id)
      expect(answer(again)).toContain("content item id ci-1")
      expect(again.structuredContent).toMatchObject({ item: { id: "ci-1", kind: "draft", text: "Soup night: three soups from issue 41." } })
      expect(itemsFake.items.size).toBe(1)
      const stale = await call("save_channel_less_draft", { contentItemId: "ci-1", text: "New", expectedText: "Something older" })
      expect(stale.isError).toBe(true)
      expect(answer(stale)).toContain("changed in Buffer since it was read")
      expect(itemsFake.items.get("ci-1")!.body.text).toBe("Soup night: three soups from issue 41.")
      expect((await call("save_channel_less_draft", { contentItemId: "ci-1", text: "New" })).isError).toBe(true)
      expect(answer(await call("save_channel_less_draft", { contentItemId: "ci-1", text: "Soup night!", expectedText: "Soup night: three soups from issue 41." }))).toContain("Draft text replaced")
    })

    it("reports Buffer's refusal of a save as a refusal, not as an unclear answer", async () => {
      itemsFake.createRefusal = "Invalid correlationId"
      const r = await saveDraft()
      expect(r.isError).toBe(true)
      expect(answer(r)).toContain("Not saved: Buffer refused it (Invalid correlationId)")
      expect(answer(r)).not.toContain("may or may not")
      expect(itemsFake.items.size).toBe(0)
    })

    it("keeps unknown Buffer errors and timeouts as unclear, so the same requestId is retried", async () => {
      const { refusedByBuffer } = await import("@/lib/content-item-flow")
      expect(refusedByBuffer(new BufferApiError("Internal server error", 200, "INTERNAL_SERVER_ERROR"))).toBe(false)
      expect(refusedByBuffer(new BufferApiError("Something went wrong", 200))).toBe(false)
      expect(refusedByBuffer(new BufferApiError("Invalid response from upstream", 200))).toBe(false)
      expect(refusedByBuffer(new BufferApiError("Invalid correlationId", 200))).toBe(true)
      expect(refusedByBuffer(new BufferApiError("text is required", 200))).toBe(true)
      expect(refusedByBuffer(new BufferApiError("Buffer API returned 408", 408))).toBe(false)
      expect(refusedByBuffer(new BufferApiError("Buffer API returned 503", 503))).toBe(false)
      expect(refusedByBuffer(new BufferApiError("Bad input", 200, "BAD_USER_INPUT"))).toBe(true)
      expect(refusedByBuffer(new BufferApiError("Buffer API returned 422", 422))).toBe(true)
      itemsFake.createRefusal = "Internal server error"
      const id = crypto.randomUUID()
      const r = answer(await saveDraft(undefined, id))
      expect(r).toContain(`Retry with requestId "${id}"`)
      expect(r).not.toContain("pass a new random UUID")
    })

    it("turns a draft into one checked draft per account with each version's own evidence, and never schedules", async () => {
      itemsFake.extraChannels = [second]
      rules.set("person-a", [{ id: "stock", kind: "replace", from: "broth", to: "stock", channels: "all", level: "block", text: "Say stock." }])
      await saveDraft()
      const { recordEvidence } = await import("@/lib/source-store")
      vi.mocked(recordEvidence).mockClear()
      const versions = [
        { channelId: "ch", text: "Intro. Closing evidence. Long form for LinkedIn.", snapshotId: "saved-podcast", evidence: [{ claim: "Intro.", quote: "Intro." }] },
        { channelId: "ch2", text: "Closing evidence. Short for X.", snapshotId: "saved-podcast", evidence: [{ claim: "Closing evidence.", quote: "Closing evidence." }] },
      ]
      const brothy = await call("promote_to_draft_posts", { contentItemId: "ci-1", expectedDraftText: "Soup night: three soups from issue 41.", versions: [versions[0], { ...versions[1], text: "Closing evidence. Made with broth, for X." }] })
      expect(JSON.parse(answer(brothy))).toMatchObject({ status: "refused", created: false })
      expect(brothy.structuredContent).toMatchObject({ status: "refused", item: null, created: null, refused: [{ channel_id: "ch2" }] })
      expect(itemsFake.promotes).toBe(0)
      const stale = await call("promote_to_draft_posts", { contentItemId: "ci-1", expectedDraftText: "An older draft", versions })
      expect(answer(stale)).toContain("changed in Buffer since it was reviewed")
      expect(itemsFake.promotes).toBe(0)
      const done = await call("promote_to_draft_posts", { contentItemId: "ci-1", expectedDraftText: "Soup night: three soups from issue 41.", versions })
      const ok = answer(done)
      expect(ok).toContain("Buffer has 2 drafts from this promotion; Queue Pilot recorded 2 as its own. None are scheduled.")
      expect(done.structuredContent).toMatchObject({ status: "drafts", item: { id: "ci-1", kind: "posts" }, created: 2, recorded: 2, refused: [] })
      // Both versions name their source, so neither is remarked on as having none.
      expect(ok).not.toContain("No source.")
      // The next read tells the truth without a manual refresh: both new drafts are listed.
      const listed = answer(await call("list_my_drafts"))
      for (const v of versions) expect(listed).toContain(v.text)
      expect(posts.filter((p) => p.status !== "draft")).toEqual([])
      const mine = written.get("person-a") ?? []
      expect(mine.map((w) => w.text).sort()).toEqual(versions.map((v) => v.text).sort())
      expect(mine.every((w) => Array.isArray(w.verdicts) && w.playbookRevision)).toBe(true)
      expect(vi.mocked(recordEvidence).mock.calls.map((c) => [c[2], c[4]])).toEqual(versions.map((v) => [v.text, v.evidence]))
      // Deleting the item deletes its posts, and the next read no longer lists them.
      // Link (already in), unlink, link back: each answers with the item as data, and the item ends as it began.
      // The two drafts this promote made, in the order of the versions.
      const made = posts.filter((p) => versions.some((v) => v.text === p.text)).map((p) => p.id)
      expect(made).toHaveLength(2)
      const linked = await call("link_post_to_content_item", { contentItemId: "ci-1", postId: made[1] })
      expect(outcome(linked)).toEqual({ isError: false, answer: expect.any(String) })
      expect(linked.structuredContent).toMatchObject({ item: { id: "ci-1" } })
      const unlinked = await call("unlink_post_from_content_item", { contentItemId: "ci-1", postId: made[1] })
      expect(outcome(unlinked)).toEqual({ isError: false, answer: expect.any(String) })
      expect(unlinked.structuredContent).toMatchObject({ item: { id: "ci-1" } })
      expect((await call("link_post_to_content_item", { contentItemId: "ci-1", postId: made[1] })).structuredContent).toMatchObject({ item: { id: "ci-1" } })
      const gone = await call("delete_content_item", { contentItemId: "ci-1" })
      expect(answer(gone)).toContain("deleted")
      expect(gone.structuredContent).toEqual({ content_item_id: "ci-1", deleted: true, post_ids: made })
      expect(lastAction("content_item_deleted")).toMatchObject({ by: { via: "ai", app: "ChatGPT" }, facts: { ids: expect.arrayContaining(["ci-1"]) } })
      const after = answer(await call("list_my_drafts"))
      for (const v of versions) expect(after).not.toContain(v.text)
    })

    it("turns a version that names no source into a draft, and says it has no source", async () => {
      await saveDraft()
      const ok = answer(await call("promote_to_draft_posts", { contentItemId: "ci-1", expectedDraftText: "Soup night: three soups from issue 41.", versions: [{ channelId: "ch", text: "Soup night on LinkedIn." }] }))
      expect(ok).toContain("Buffer has 1 draft from this promotion; Queue Pilot recorded 1 as its own. None are scheduled.")
      expect(ok).toContain(": No source. This draft cites nothing saved in Queue Pilot. Check where it came from before approving.")
      expect(posts.filter((p) => p.status === "draft")).toHaveLength(1)
    })

    it("records the drafts after an unclear promote, whether Buffer returns a failure or the answer is lost, and a retry never promotes twice", async () => {
      for (const mode of ["failAfter", "throwAfter"] as const) {
        reset(); written.clear(); setPosts([])
        await saveDraft()
        itemsFake.promote = mode
        const v = [{ channelId: "ch", text: "Soup night on LinkedIn." }]
        const first = answer(await call("promote_to_draft_posts", { contentItemId: "ci-1", expectedDraftText: "Soup night: three soups from issue 41.", versions: v }))
        expect({ mode, text: first }).toEqual({ mode, text: expect.stringContaining("The drafts were created anyway. Buffer has 1 draft from this promotion; Queue Pilot recorded 1 as its own.") })
        // Also after a recovery: the drafts Buffer did create show up on the next read.
        expect({ mode, text: answer(await call("list_my_drafts")) }).toEqual({ mode, text: expect.stringContaining("Soup night on LinkedIn.") })
        const recorded = structuredClone(written.get("person-a"))
        expect(recorded?.map((w) => w.text)).toEqual(["Soup night on LinkedIn."])
        expect(attemptStore.store.rows.get("person-a|ci-1")?.recordedAt).toBeInstanceOf(Date)
        // The recovery finished, so a retry is a no-op: no second promote, the saved record untouched.
        expect(answer(await call("promote_to_draft_posts", { contentItemId: "ci-1", expectedDraftText: "Soup night: three soups from issue 41.", versions: v }))).toContain("Already turned into drafts and recorded")
        expect(itemsFake.promotes).toBe(1)
        expect(written.get("person-a")).toEqual(recorded)
      }
      reset(); setPosts([])
      await saveDraft()
      itemsFake.promote = "refuse"
      const refused = await call("promote_to_draft_posts", { contentItemId: "ci-1", expectedDraftText: "Soup night: three soups from issue 41.", versions: [{ channelId: "ch", text: "Soup night." }] })
      expect(refused.isError).toBe(true)
      expect(answer(refused)).toContain("still a channel-less draft; nothing was created")
    })

    it("never adopts posts it did not create, and leaves drafts with media alone", async () => {
      await saveDraft()
      // Posts made in Buffer (or by another app) with the same account and text: no attempt by Queue Pilot exists.
      itemsFake.items.get("ci-1")!.body = { __typename: "PostContent", posts: [{ id: "elsewhere", channelId: "ch", status: "draft", text: "Soup night on LinkedIn.", dueAt: null }] }
      const adopt = await call("promote_to_draft_posts", { contentItemId: "ci-1", expectedDraftText: "Soup night: three soups from issue 41.", versions: [{ channelId: "ch", text: "Soup night on LinkedIn." }] })
      expect(adopt.isError).toBe(true)
      expect(answer(adopt)).toContain("did not create")
      expect(written.get("person-a") ?? []).toEqual([])
      // An attempt for different versions does not count either.
      attemptStore.store.rows.set("person-a|ci-1", { fingerprint: "something-else", token: "t", recordedAt: null, startedAt: new Date() })
      expect((await call("promote_to_draft_posts", { contentItemId: "ci-1", expectedDraftText: "x", versions: [{ channelId: "ch", text: "Soup night on LinkedIn." }] })).isError).toBe(true)
      expect(written.get("person-a") ?? []).toEqual([])
      await saveDraft("With a photo")
      itemsFake.items.get("ci-2")!.body.assets = [{ type: "image" }]
      expect(answer(await call("save_channel_less_draft", { contentItemId: "ci-2", text: "New", expectedText: "With a photo" }))).toContain("images or video attached")
      expect(answer(await call("promote_to_draft_posts", { contentItemId: "ci-2", expectedDraftText: "With a photo", versions: [{ channelId: "ch", text: "With a photo" }] }))).toContain("images or video attached")
      expect(itemsFake.items.get("ci-2")!.body).toMatchObject({ text: "With a photo", assets: [{ type: "image" }] })
      expect(itemsFake.promotes).toBe(0)
    })

    it("keeps recovery open until every draft is recorded with its evidence, then records nothing again", async () => {
      await saveDraft()
      const { recordEvidence } = await import("@/lib/source-store")
      vi.mocked(recordEvidence).mockClear().mockRejectedValueOnce(new Error("db down"))
      const v = [{ channelId: "ch", text: "Intro. Closing evidence.", snapshotId: "saved-podcast", evidence: [{ claim: "Intro.", quote: "Intro." }] }]
      const first = await call("promote_to_draft_posts", { contentItemId: "ci-1", expectedDraftText: "Soup night: three soups from issue 41.", versions: v })
      expect(first.isError).toBe(true)
      expect(answer(first)).toContain("Buffer has 1 draft from this promotion; Queue Pilot recorded 0 as its own")
      expect(written.get("person-a") ?? []).toEqual([])
      expect(attemptStore.store.rows.get("person-a|ci-1")?.recordedAt).toBeNull()
      const repair = answer(await call("promote_to_draft_posts", { contentItemId: "ci-1", expectedDraftText: "Soup night: three soups from issue 41.", versions: v }))
      expect(repair).toContain("Queue Pilot recorded 1 as its own")
      expect(written.get("person-a")).toHaveLength(1)
      expect(attemptStore.store.rows.get("person-a|ci-1")?.recordedAt).toBeInstanceOf(Date)
      const evidenceCalls = vi.mocked(recordEvidence).mock.calls.length
      expect(answer(await call("promote_to_draft_posts", { contentItemId: "ci-1", expectedDraftText: "Soup night: three soups from issue 41.", versions: v }))).toContain("Already turned into drafts and recorded")
      expect(vi.mocked(recordEvidence).mock.calls.length).toBe(evidenceCalls)
      expect(itemsFake.promotes).toBe(1)
    })

    it("stops a promotion when an image was attached in Buffer while the versions were being checked", async () => {
      await saveDraft()
      itemsFake.reads = 0
      itemsFake.attachOnRead = 2
      const r = await call("promote_to_draft_posts", { contentItemId: "ci-1", expectedDraftText: "Soup night: three soups from issue 41.", versions: [{ channelId: "ch", text: "Soup night." }] })
      expect(answer(r)).toContain("images or video attached")
      expect(itemsFake.promotes).toBe(0)
      expect(itemsFake.items.get("ci-1")!.body.assets).toEqual([{ type: "image" }])
    })

    it("checks each version against the account's own text limit from Buffer, not a fixed table", async () => {
      await saveDraft()
      libFake.maxLength = 20
      try {
        const r = JSON.parse(answer(await call("promote_to_draft_posts", { contentItemId: "ci-1", expectedDraftText: "Soup night: three soups from issue 41.", versions: [{ channelId: "ch", text: "This version is longer than twenty." }] })))
        expect(r).toMatchObject({ status: "refused", created: false })
        expect(r.refused[0]).toContain("this account's 20 character limit")
        expect(itemsFake.promotes).toBe(0)
        const checked = JSON.parse(answer(await call("check_draft", { text: "This version is longer than twenty.", network: "linkedin", channelId: "ch" })))
        expect(checked).toMatchObject({ status: "refused", limit: { max: 20, from: "buffer" } })
        // Buffer allows more than the built-in table: before the ordinary save, the stricter built-in limit still applies.
        libFake.maxLength = 25_000
        const long = "x".repeat(3100)
        const strict = JSON.parse(answer(await call("check_draft", { text: long, network: "linkedin", channelId: "ch" })))
        expect(strict).toMatchObject({ status: "refused", limit: { max: 3000, from: "built-in" } })
        expect(strict.reason).toContain("Queue Pilot's current save limit of 3000")
        expect(strict.reason).toContain("Buffer allows this account 25000")
      } finally {
        libFake.maxLength = 3000
      }
    })

    it("refuses a second promotion with different versions while the first is pending", async () => {
      await saveDraft()
      attemptStore.store.rows.set("person-a|ci-1", { fingerprint: "another-call", token: "t", recordedAt: null, startedAt: new Date() })
      const r = await call("promote_to_draft_posts", { contentItemId: "ci-1", expectedDraftText: "Soup night: three soups from issue 41.", versions: [{ channelId: "ch", text: "Soup night." }] })
      expect(r.isError).toBe(true)
      expect(answer(r)).toContain("still in progress")
      expect(itemsFake.promotes).toBe(0)
    })

    it("never takes a failed read for a missing or deleted item", async () => {
      await saveDraft()
      itemsFake.readFails = true
      const read = await call("get_content_item", { contentItemId: "ci-1" })
      expect(read.isError).toBe(true)
      expect(answer(read)).not.toContain("No content item with that id")
      itemsFake.readFails = false
      itemsFake.deleteThrows = true
      const del = await call("delete_content_item", { contentItemId: "ci-1" })
      expect(del.isError).toBe(true)
      expect(answer(del)).toContain("whether it was deleted is unknown")
      expect(answer(del)).not.toContain("delete took effect")
    })

    it("refuses another person's items, accounts and sources before writing, and renames, re-dates or deletes only on request", async () => {
      await saveDraft()
      const theirs = { ...itemsFake.items.get("ci-1")!, id: "ci-x", organizationId: "someone-elses-org" }
      itemsFake.items.set("ci-x", theirs)
      expect(answer(await call("get_content_item", { contentItemId: "ci-x" }))).toContain("No content item with that id")
      expect((await call("delete_content_item", { contentItemId: "ci-x" })).isError).toBe(true)
      expect(itemsFake.items.has("ci-x")).toBe(true)
      expect(answer(await call("promote_to_draft_posts", { contentItemId: "ci-1", expectedDraftText: "Soup night: three soups from issue 41.", versions: [{ channelId: "not-mine", text: "x" }] }))).toContain("Not the person's accounts")
      expect(answer(await call("promote_to_draft_posts", { contentItemId: "ci-1", expectedDraftText: "Soup night: three soups from issue 41.", versions: [{ channelId: "ch", text: "x", snapshotId: "saved-podcast" }] }, "person-b"))).toContain("not in this account")
      expect(itemsFake.promotes).toBe(0)
      const renamed = await call("update_content_item", { contentItemId: "ci-1", title: "Soup week" })
      expect(answer(renamed)).toContain('"Soup week"')
      expect(renamed.structuredContent).toMatchObject({ item: { id: "ci-1", title: "Soup week" } })
      expect((await call("update_content_item", { contentItemId: "ci-1" })).isError).toBe(true)
      const listed = await call("list_content_items")
      expect(answer(listed)).toContain("Channel-less draft (written with AI)")
      // Typed results: the same facts as data, built from Buffer's item, never parsed from the text.
      expect(listed.structuredContent).toMatchObject({ more: false, cursor: null })
      expect(listed.structuredContent?.items).toEqual(expect.arrayContaining([expect.objectContaining({ id: "ci-1", title: "Soup week", kind: "draft", text: "Soup night: three soups from issue 41." })]))
      expect((await call("get_content_item", { contentItemId: "ci-1" })).structuredContent).toMatchObject({ item: { id: "ci-1", kind: "draft" } })
      expect(answer(await call("delete_content_item", { contentItemId: "ci-1" }))).toContain("deleted")
      expect(itemsFake.items.has("ci-1")).toBe(false)
    })
  })
})

describe("typed results proven in this file", () => {
  it("returns typed data from every tool this file proves", () => {
    expect(TOOL_OWNERS["content-items"].filter((tool) => !typedSuccess.has(tool))).toEqual([])
  })
})
