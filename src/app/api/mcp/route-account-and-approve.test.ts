/**
 * @fileoverview MCP route: account controls, the AI model, approving drafts and review links.
 * Shared mocks, fakes and helpers: src/test/mcp-route-setup.ts and src/test/fake-buffer-api.ts.
 */
import { aiCalls, answer, buffer, call, confirm, lastAction, limits, material, ownKey, perm, pulledBackIds, reviews, ruleStore, rules, typedSuccess, written } from "@/test/mcp-route-setup"
import { TOOL_OWNERS } from "@/test/mcp-tool-owners"
import { posts, setPosts } from "@/test/fake-buffer-api"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { Rule } from "@/lib/rules"

describe("remaining account controls", () => {
  it("removes only owned research and preserves existing drafts", async () => {
    const a = await material.add("person-a", { title: "A", text: "My research" });
    const b = await material.add("person-b", { title: "B", text: "Private research" });
    expect((await call("remove_material", { key: b.key, userId: "person-b" })).isError).toBe(true);
    await call("remove_material", { key: a.key });
    expect(await material.get("person-a", a.key)).toBeNull();
    expect(await material.get("person-b", b.key)).not.toBeNull();
    expect(buffer.calls).toHaveLength(0);
  });
  it("lists genuine repeated fixes from only the authenticated user's written drafts", async () => {
    setPosts([1, 2].map(i => ({ id: `p${i}`, channelId: "ch", status: "draft" as const, via: "api" as const, text: `Use stock to make soup number ${i} for dinner.`, dueAt: "2026-11-02T09:00:00.000Z", sentAt: null, externalLink: null, error: null })));
    written.set("person-a", posts.map(p => ({ postId: p.id, text: p.text.replace("stock", "broth"), network: "linkedin" })));
    await call("refresh_buffer");
    setPosts(posts.map(p => ({ ...p, text: p.text!.replace("stock", "broth") })));
    vi.setSystemTime(new Date("2026-10-29T12:02:00Z"));
    await call("refresh_buffer");
    setPosts(posts.map(p => ({ ...p, text: p.text!.replace("broth", "stock") })));
    vi.setSystemTime(new Date("2026-10-29T12:03:00Z"));
    const found = JSON.parse(answer(await call("list_rule_suggestions", { mode: "fixes" })));
    expect(found.suggestions).toHaveLength(1);
    expect(found.suggestions[0].rule).toMatchObject({ kind: "replace", from: "broth", to: "stock" });
    expect(found.suggestions[0].evidence.examples).toHaveLength(2);
    expect(JSON.parse(answer(await call("list_rule_suggestions", { mode: "fixes" }, "person-b"))).suggestions).toHaveLength(0);
    await call("dismiss_suggestion", { token: found.suggestions[0].token });
    expect(JSON.parse(answer(await call("list_rule_suggestions", { mode: "fixes" }))).suggestions).toHaveLength(0);
  });
  it("learns a repeated emoji removal through the connector and keeps its real evidence", async () => {
    setPosts([1, 2].map(i => ({ id: `emoji-${i}`, channelId: "ch", status: "draft" as const, via: "buffer" as const, text: `A useful release for builders today, part ${i}.`, dueAt: "2026-11-02T09:00:00.000Z", sentAt: null, externalLink: null, error: null })));
    written.set("person-a", posts.map(p => ({ postId: p.id, text: `${p.text} 🚀`, network: "twitter" })));
    const found = JSON.parse(answer(await call("list_rule_suggestions", { mode: "fixes" })));
    expect(found.suggestions).toHaveLength(1);
    expect(found.suggestions[0].rule).toMatchObject({ kind: "banned", phrases: ["🚀"], level: "block" });
    expect(found.suggestions[0].evidence.why).toBe("Both drafts make the same change.");
    expect(found.suggestions[0].evidence.examples).toHaveLength(2);
    const kept = JSON.parse(answer(await call("keep_suggestion", { token: found.suggestions[0].token })));
    expect(kept.ok).toBe(true);
    expect(answer(await call("read_rule", { id: kept.id }))).toContain("🚀");
  });
  it("offers no rule when the model reads a repeated fix as a one-off fact, and settles the AI action", async () => {
    confirm.verdict = "fact";
    setPosts([1, 2].map(i => ({ id: `fact-${i}`, channelId: "ch", status: "draft" as const, via: "buffer" as const, text: `Release ${i} is out today for builders.`, dueAt: "2026-11-02T09:00:00.000Z", sentAt: null, externalLink: null, error: null })));
    written.set("person-a", posts.map(p => ({ postId: p.id, text: `${p.text} https://example.com/old`, network: "twitter" })));
    const found = JSON.parse(answer(await call("list_rule_suggestions", { mode: "fixes" })));
    confirm.verdict = "preference";
    expect(found.suggestions).toHaveLength(0);
    expect(found.note).toContain("none looked like a lasting preference");
    expect(aiCalls.settle).toHaveBeenCalled();
  });
  it("applies the AI limit only when the model must be asked, so a saved answer is still served", async () => {
    setPosts([1, 2].map(i => ({ id: `lim-${i}`, channelId: "ch", status: "draft" as const, via: "buffer" as const, text: `Shipping note ${i} for builders.`, dueAt: "2026-11-02T09:00:00.000Z", sentAt: null, externalLink: null, error: null })));
    written.set("person-a", posts.map(p => ({ postId: p.id, text: `${p.text} Thrilled!`, network: "twitter" })));
    limits.blocked = "ai";
    const blocked = JSON.parse(answer(await call("list_rule_suggestions", { mode: "fixes" })));
    expect(blocked.note).toContain("Too many AI requests");
    limits.blocked = "";
    await call("list_rule_suggestions", { mode: "fixes" });
    limits.blocked = "ai";
    const saved = JSON.parse(answer(await call("list_rule_suggestions", { mode: "fixes" })));
    limits.blocked = "";
    expect(saved.suggestions).toHaveLength(1);
  });
  it("lets only one of two simultaneous checks ask the model", async () => {
    setPosts([1, 2].map(i => ({ id: `race-${i}`, channelId: "ch", status: "draft" as const, via: "buffer" as const, text: `Shipping note ${i} for builders.`, dueAt: "2026-11-02T09:00:00.000Z", sentAt: null, externalLink: null, error: null })));
    written.set("person-a", posts.map(p => ({ postId: p.id, text: `${p.text} Thrilled!`, network: "twitter" })));
    let go!: () => void;
    confirm.wait = new Promise<void>(r => { go = r; });
    const before = confirm.calls;
    const both = Promise.all([call("list_rule_suggestions", { mode: "fixes" }), call("list_rule_suggestions", { mode: "fixes" })]);
    await vi.waitFor(() => expect(confirm.calls).toBe(before + 1));
    go();
    const [a, b] = (await both).map(r => JSON.parse(answer(r)));
    confirm.wait = null;
    expect(confirm.calls).toBe(before + 1);
    expect([a.suggestions.length, b.suggestions.length].sort((x, y) => x - y)).toEqual([0, 1]);
    expect([a.note, b.note].join(" ")).toContain("already checking");
  });
  it("does not save an answer that skipped a repeat, so the next check asks again", async () => {
    setPosts([1, 2].map(i => ({ id: `gap-${i}`, channelId: "ch", status: "draft" as const, via: "buffer" as const, text: `Shipping note ${i} for builders.`, dueAt: "2026-11-02T09:00:00.000Z", sentAt: null, externalLink: null, error: null })));
    written.set("person-a", posts.map(p => ({ postId: p.id, text: `${p.text} Thrilled!`, network: "twitter" })));
    confirm.empty = true;
    const before = confirm.calls;
    const first = JSON.parse(answer(await call("list_rule_suggestions", { mode: "fixes" })));
    confirm.empty = false;
    expect(first.note).toContain("did not answer every repeat");
    const second = JSON.parse(answer(await call("list_rule_suggestions", { mode: "fixes" })));
    expect(confirm.calls).toBe(before + 2);
    expect(second.suggestions).toHaveLength(1);
  });
  it("reuses the saved answer for the same unchanged repeats without another AI action", async () => {
    setPosts([1, 2].map(i => ({ id: `reuse-${i}`, channelId: "ch", status: "draft" as const, via: "buffer" as const, text: `Shipping note ${i} for builders.`, dueAt: "2026-11-02T09:00:00.000Z", sentAt: null, externalLink: null, error: null })));
    written.set("person-a", posts.map(p => ({ postId: p.id, text: `${p.text} Thrilled!`, network: "twitter" })));
    const before = confirm.calls;
    const first = JSON.parse(answer(await call("list_rule_suggestions", { mode: "fixes" })));
    aiCalls.settle.mockClear();
    const second = JSON.parse(answer(await call("list_rule_suggestions", { mode: "fixes" })));
    expect(first.suggestions).toHaveLength(1);
    expect(second.suggestions.map((s: { key: string }) => s.key)).toEqual(first.suggestions.map((s: { key: string }) => s.key));
    expect(second.suggestions[0].token).toBeTruthy();
    expect(confirm.calls).toBe(before + 1);
    expect(aiCalls.settle).not.toHaveBeenCalled();
    setPosts(posts.map(p => ({ ...p, text: `${p.text} More.` })));
    vi.setSystemTime(new Date(Date.now() + 31_000));
    await call("list_rule_suggestions", { mode: "fixes" });
    expect(confirm.calls).toBe(before + 2);
  });
  it("spends no AI action when no fix repeats", async () => {
    const before = confirm.calls;
    const found = JSON.parse(answer(await call("list_rule_suggestions", { mode: "fixes" })));
    expect(found.suggestions).toHaveLength(0);
    expect(confirm.calls).toBe(before);
    expect(aiCalls.settle).not.toHaveBeenCalled();
  });
  it("reads channels and AI allowance without consuming an AI action", async () => {
    vi.stubEnv("SETTINGS_KEY", "");
    const channels = JSON.parse(answer(await call("list_channels")));
    expect(channels.channels[0]).toMatchObject({ id: "ch", isDisconnected: false, isQueuePaused: false });
    const usage = answer(await call("get_ai_usage"));
    expect(JSON.parse(usage)).toMatchObject({ ownKeySaved: false, builtIn: { budgetUsd: 100, leftUsd: 99.95 } });
    expect(usage).not.toContain("never-display");
    expect(aiCalls.settle).not.toHaveBeenCalled();
  });
});

describe("connector AI model", () => {
  afterEach(() => { ownKey.saved = null; ownKey.setModel.mockReset() })
  it("refuses both model tools when no key is saved, and never asks for one", async () => {
    vi.stubEnv("SETTINGS_KEY", "k".repeat(64))
    expect((await call("list_ai_models")).isError).toBe(true)
    expect((await call("set_ai_model", { model: "model-a" })).isError).toBe(true)
    expect(ownKey.setModel).not.toHaveBeenCalled()
  })
  it("lists the key's models without the key, and switches only to one of them", async () => {
    vi.stubEnv("SETTINGS_KEY", "k".repeat(64))
    ownKey.saved = { provider: "openai", key: "never-display", model: "model-a" }
    const listed = answer(await call("list_ai_models"))
    expect(JSON.parse(listed)).toEqual({ provider: "openai", selected: "model-a", models: ["model-a", "model-b"] })
    expect(listed).not.toContain("never-display")
    expect((await call("set_ai_model", { model: "not-offered" })).isError).toBe(true)
    expect(ownKey.setModel).not.toHaveBeenCalled()
    expect((await call("set_ai_model", { model: "model-b" })).isError).toBeFalsy()
    expect(ownKey.setModel).toHaveBeenCalledWith("person-a", "model-b")
  })
})

describe("connector approve", () => {
  const draft = { id: "d1", channelId: "ch", status: "draft" as const, via: "api" as const, text: "Monday post.", dueAt: "2026-11-02T09:00:00.000Z", sentAt: null, externalLink: null, error: null }
  beforeEach(() => { setPosts([draft]); perm.approve.mockReset().mockResolvedValue({ approved: ["d1"], refused: [] }) })
  afterEach(() => { perm.mode = "ask" })
  it("refuses when the person turned approving from apps off", async () => {
    perm.mode = "off"
    expect((await call("approve_drafts", { postIds: ["d1"] })).isError).toBe(true)
    expect(perm.approve).not.toHaveBeenCalled()
  })
  it("asks first by default: the first call schedules nothing and names the drafts", async () => {
    const first = answer(await call("approve_drafts", { postIds: ["d1"] }))
    expect(first).toContain("Nothing approved yet")
    expect(first).toContain("Monday post.")
    expect(perm.approve).not.toHaveBeenCalled()
    const token = first.match(/confirmToken: (\S+)/)![1]
    expect((await call("approve_drafts", { postIds: ["d1", "d2"], confirmToken: token })).isError).toBe(true)
    expect((await call("approve_drafts", { postIds: ["d1"], confirmToken: token }, "person-b")).isError).toBe(true)
    expect(perm.approve).not.toHaveBeenCalled()
    expect(lastAction("drafts_approved")).toBeUndefined()
    expect(answer(await call("approve_drafts", { postIds: ["d1"], confirmToken: token }))).toContain("1 scheduled")
    expect(perm.approve).toHaveBeenCalledTimes(1)
    expect(lastAction("drafts_approved")).toMatchObject({ userId: "person-a", by: { via: "ai", app: "ChatGPT" }, facts: { ids: ["d1"] } })
  })
  it("refuses an expired confirmation", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    const token = answer(await call("approve_drafts", { postIds: ["d1"] })).match(/confirmToken: (\S+)/)![1]
    vi.setSystemTime(new Date(Date.now() + 11 * 60_000))
    expect((await call("approve_drafts", { postIds: ["d1"], confirmToken: token })).isError).toBe(true)
    expect(perm.approve).not.toHaveBeenCalled()
    vi.useRealTimers()
  })
  it("refuses an approval token after the shown draft text or time changes", async () => {
    const token = answer(await call("approve_drafts", { postIds: ["d1"] })).match(/confirmToken: (\S+)/)![1]
    setPosts([{ ...draft, text: "Different content never shown for approval.", dueAt: "2026-11-03T12:00:00.000Z" }])
    const result = await call("approve_drafts", { postIds: ["d1"], confirmToken: token })
    expect(result.isError).toBe(true)
    expect(perm.approve).not.toHaveBeenCalled()
  })
  it("uses a yes once, so a draft returned to drafts cannot be scheduled again with it", async () => {
    const token = answer(await call("approve_drafts", { postIds: ["d1"] })).match(/confirmToken: (\S+)/)![1]
    await call("approve_drafts", { postIds: ["d1"], confirmToken: token })
    setPosts([{ ...draft }])
    perm.approve.mockClear()
    const result = await call("approve_drafts", { postIds: ["d1"], confirmToken: token })
    expect(result.isError).toBe(true)
    expect(perm.approve).not.toHaveBeenCalled()
  })
  it("lets the same yes try again when nothing was scheduled", async () => {
    const token = answer(await call("approve_drafts", { postIds: ["d1"] })).match(/confirmToken: (\S+)/)![1]
    perm.approve.mockResolvedValueOnce({ approved: [], refused: [{ id: "d1", reason: "Buffer could not be reached." }] })
    expect((await call("approve_drafts", { postIds: ["d1"], confirmToken: token })).isError).toBe(true)
    expect(answer(await call("approve_drafts", { postIds: ["d1"], confirmToken: token }))).toContain("1 scheduled")
  })
  it("a changed setting invalidates outstanding confirmations", async () => {
    const token = answer(await call("approve_drafts", { postIds: ["d1"] })).match(/confirmToken: (\S+)/)![1]
    perm.mode = "off"
    await call("approve_drafts", { postIds: ["d1"], confirmToken: token })
    perm.mode = "ask"
    const result = await call("approve_drafts", { postIds: ["d1"], confirmToken: token })
    expect(result.isError).toBe(true)
    expect(perm.approve).not.toHaveBeenCalled()
  })
  it("shares the Buffer write allowance in both modes", async () => {
    limits.blocked = "bufferWrite"
    try {
      const token = answer(await call("approve_drafts", { postIds: ["d1"] })).match(/confirmToken: (\S+)/)![1]
      expect((await call("approve_drafts", { postIds: ["d1"], confirmToken: token })).isError).toBe(true)
      perm.mode = "direct"
      expect((await call("approve_drafts", { postIds: ["d1"] })).isError).toBe(true)
      expect(perm.approve).not.toHaveBeenCalled()
    } finally { limits.blocked = "" }
  })
  it.each(["unsure", "missing"])("refuses a %s blocking result through the real approval gate", async kind => {
    perm.mode = "direct";
    const rule: Rule = { id: "mandatory", kind: "guidance", text: "Name the change.", channels: "all", level: "block" };
    rules.set("person-a", [rule]);
    const { playbookVersion } = await import("@/lib/playbook-version");
    written.set("person-a", [{ postId: draft.id, network: "linkedin", text: draft.text, playbookRevision: playbookVersion([rule]), verdicts: kind === "missing" ? [] : [{ ruleId: rule.id, rule: rule.text, level: "block", verdict: "unsure", probability: null, quote: "", reason: "Uncertain" }] }]);
    const result = await call("approve_drafts", { postIds: [draft.id] });
    expect(result.isError).toBe(true);
    expect(perm.approve).not.toHaveBeenCalled();
  });
  it("does not release a confirmation when a scheduling response was lost", async () => {
    const token = answer(await call("approve_drafts", { postIds: ["d1"] })).match(/confirmToken: (\S+)/)![1];
    perm.approve.mockResolvedValueOnce({ approved: [], refused: [{ id: "d1", reason: "Not confirmed" }], uncertain: ["d1"] });
    await call("approve_drafts", { postIds: ["d1"], confirmToken: token });
    perm.approve.mockClear();
    const retry = await call("approve_drafts", { postIds: ["d1"], confirmToken: token });
    expect(retry.isError).toBe(true);
    expect(perm.approve).not.toHaveBeenCalled();
  });
  it("schedules in one call when the person chose not to be asked", async () => {
    perm.mode = "direct"
    expect(answer(await call("approve_drafts", { postIds: ["d1"] }))).toContain("1 scheduled")
    expect(perm.approve).toHaveBeenCalledTimes(1)
  })

  it("never schedules a post the person took off the schedule, even when they chose not to be asked", async () => {
    perm.mode = "direct"
    pulledBackIds.add("d1")
    try {
      const r = await call("approve_drafts", { postIds: ["d1"] })
      expect(r.isError).toBe(true)
      expect(answer(r)).toContain("moved this post back to draft")
      expect(perm.approve).not.toHaveBeenCalled()
    } finally { pulledBackIds.clear() }
  })
})

describe("connector review links", () => {
  it("shares only the person's own drafts under a link on this site, lists the comments, and turns the link off", async () => {
    setPosts([{ id: "d1", channelId: "ch", status: "draft", via: "api", text: "Day 4 of Queue Pilot.", dueAt: "2026-11-02T09:00:00.000Z", sentAt: null, externalLink: null, error: null }])
    await call("show_next_week")
    expect((await call("share_for_review", { postIds: ["not-mine"] })).isError).toBe(true)
    const shared = JSON.parse(answer(await call("share_for_review", { postIds: ["d1"] })))
    expect(shared).toMatchObject({ link: "https://app.example/r/link-1", shared: 1 })
    reviews.links[0].comments.push({ id: "c1", postId: "d1", name: "Ali", text: "just say QP", quote: "Queue Pilot", start: 9, end: 20, createdAt: "2026-10-29T12:01:00Z" })
    const listed = JSON.parse(answer(await call("list_review_comments")))
    expect(listed[0]).toMatchObject({ id: "link-1", on: true, drafts: [{ postId: "d1", comments: [{ name: "Ali", quote: "Queue Pilot", comment: "just say QP" }] }] })
    expect(JSON.parse(answer(await call("list_review_comments", {}, "person-b")))).toEqual([])
    await call("turn_off_review", { id: "link-1" }, "person-b")
    expect(reviews.links[0].revokedAt).toBeNull()
    await call("turn_off_review", { id: "link-1" })
    expect(JSON.parse(answer(await call("list_review_comments")))[0].on).toBe(false)
  })

  it("spends no AI action carrying a rule across drafts when Queue Pilot wrote none", async () => {
    const id = await ruleStore.add("person-a", { kind: "guidance", text: "Say QP.", channels: "all", level: "warn" })
    await call("show_next_week")
    expect(JSON.parse(answer(await call("propose_rule_fixes", { ruleId: id })))).toEqual({ ok: true, fixes: [], checked: 0 })
    expect(aiCalls.settle).not.toHaveBeenCalled()
  })

  it("says there are no review comments yet without an AI action", async () => {
    const r = JSON.parse(answer(await call("list_rule_suggestions", { mode: "comments" })))
    expect(r.note).toContain("No review comments yet")
    expect(aiCalls.settle).not.toHaveBeenCalled()
  })
})

describe("typed results proven in this file", () => {
  it("returns typed data from every tool this file proves", () => {
    expect(TOOL_OWNERS["account-and-approve"].filter((tool) => !typedSuccess.has(tool))).toEqual([])
  })
})
