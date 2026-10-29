import { describe, expect, it } from "vitest";
import type { OpenSlot } from "./open-slots";
import { MAX_LIMIT_CHECKS, groupByChannel, saveDrafts } from "./save-drafts";

const slot = (channelId: string, at: string, over: Partial<OpenSlot> = {}): OpenSlot => ({
  id: `${channelId}@${at}`,
  channelId,
  channel: channelId === "x" ? "X" : channelId === "li" ? "LinkedIn" : "Bluesky",
  service: channelId === "x" ? "twitter" : channelId === "li" ? "linkedin" : "bluesky",
  organizationId: "org1",
  at,
  local: at,
  timezone: "UTC",
  ...over,
});

const MON = "2026-11-02T09:00:00.000Z";
const TUE = "2026-11-03T09:00:00.000Z";
const open = [slot("x", MON), slot("li", MON), slot("x", TUE), slot("bs", TUE)];

import { fakeBuffer, type Call } from "../test/fake-buffer"

const ok = (call: Call) =>
  call.query.includes("createContentItem")
    ? { createContentItem: { __typename: "CreateContentItemSuccess", content: { id: "ci" } } }
    : { createPost: { __typename: "PostActionSuccess", post: { id: "p" } } };

describe("saveDrafts", () => {
  it("saves every post as a Buffer draft marked as AI-assisted, never scheduled", async () => {
    const { q, calls } = fakeBuffer(ok);
    await saveDrafts("t", { title: "v1.4", drafts: [{ slotId: open[0].id, text: "CSV export is live" }], open }, q);
    const post = calls[0].variables.input.posts[0];
    expect(post).toMatchObject({ channelId: "x", dueAt: MON, saveToDraft: true, aiAssisted: true, mode: "customScheduled" });
  });

  it("fills a week in one request per channel round, not one per post", async () => {
    const { q, calls } = fakeBuffer(ok);
    const drafts = open.map((s) => ({ slotId: s.id, text: `post for ${s.id}` }));
    const res = await saveDrafts("t", { title: "week", drafts, open }, q);
    expect(res.saved).toHaveLength(4);
    // X has two slots, so two content items: [X Mon, LinkedIn Mon, Bluesky Tue] and [X Tue].
    expect(calls).toHaveLength(2);
    // Plus one limit check per distinct (organization, time): Monday and Tuesday.
    expect(res.requests).toBe(4);
    expect(calls[0].variables.input.posts.map((p: any) => p.channelId)).toEqual(["x", "li", "bs"]);
  });

  it("refuses a slot that is no longer open instead of double-booking it", async () => {
    const { q, calls } = fakeBuffer(ok);
    const res = await saveDrafts("t", { title: "t", drafts: [{ slotId: "x@2026-11-09T09:00:00.000Z", text: "late" }], open }, q);
    expect(res.saved).toEqual([]);
    expect(res.refused[0].reason).toMatch(/no longer empty/);
    expect(calls).toHaveLength(0);
  });

  it("refuses one over-long post without sinking the others saved with it", async () => {
    const { q } = fakeBuffer(ok);
    const res = await saveDrafts(
      "t",
      { title: "t", drafts: [{ slotId: open[3].id, text: "a".repeat(301) }, { slotId: open[1].id, text: "fits" }], open },
      q,
    );
    expect(res.saved.map((s) => s.channel)).toEqual(["LinkedIn"]);
    expect(res.refused).toEqual([{ slotId: open[3].id, reason: "Too long for Bluesky: 301 characters; bluesky allows 300." }]);
  });

  it("keeps only the first draft for a slot given twice, and refuses empty text", async () => {
    const { q } = fakeBuffer(ok);
    const res = await saveDrafts(
      "t",
      { title: "t", drafts: [{ slotId: open[0].id, text: "one" }, { slotId: open[0].id, text: "two" }, { slotId: open[1].id, text: "  " }], open },
      q,
    );
    expect(res.saved).toHaveLength(1);
    expect(res.refused.map((r) => r.reason)).toEqual(["Two drafts were given for the same slot; only the first was kept.", "The draft is empty."]);
  });

  it("reports Buffer's own reason when it refuses a content item", async () => {
    const { q } = fakeBuffer(() => ({ createContentItem: { __typename: "CreateContentItemFailure", message: "LinkedIn posts cannot exceed 3000 characters." } }));
    const res = await saveDrafts("t", { title: "t", drafts: [{ slotId: open[1].id, text: "hi" }], open }, q);
    expect(res.refused).toEqual([{ slotId: open[1].id, reason: "LinkedIn posts cannot exceed 3000 characters." }]);
  });

  it("when Buffer refuses a group, retries its posts one by one so only the bad one is refused", async () => {
    const { q, calls } = fakeBuffer((call) =>
      call.query.includes("createContentItem")
        ? { createContentItem: { __typename: "CreateContentItemFailure", message: "Instagram posts need an image." } }
        : call.variables.input.channelId === "li"
          ? { createPost: { __typename: "MutationError", message: "LinkedIn refused this one." } }
          : { createPost: { __typename: "PostActionSuccess", post: { id: "p" } } },
    );
    const res = await saveDrafts("t", { title: "t", drafts: [{ slotId: open[0].id, text: "a" }, { slotId: open[1].id, text: "b" }], open }, q);
    expect(res.saved.map((x) => x.slotId)).toEqual([open[0].id]);
    expect(res.refused).toEqual([{ slotId: open[1].id, reason: "LinkedIn refused this one." }]);
    expect(calls.map((c) => (c.query.includes("createContentItem") ? "item" : "post"))).toEqual(["item", "post", "post"]);
  });

  it("falls back to one createPost per draft when Buffer drops the experimental createContentItem", async () => {
    const { q, calls } = fakeBuffer((call) =>
      call.query.includes("createContentItem") ? new Error('Cannot query field "createContentItem" on type "Mutation".') : ok(call),
    );
    const res = await saveDrafts("t", { title: "t", drafts: [{ slotId: open[0].id, text: "a" }, { slotId: open[1].id, text: "b" }], open }, q);
    expect(res.saved).toHaveLength(2);
    expect(calls.map((c) => (c.query.includes("createContentItem") ? "item" : "post"))).toEqual(["item", "post", "post"]);
    expect(calls[1].variables.input).toMatchObject({ saveToDraft: true, aiAssisted: true });
  });

  it("does not fall back on an ordinary network error; it checks Buffer and reports it", async () => {
    const { q, calls } = fakeBuffer(() => new Error("Buffer API error (502)"));
    const res = await saveDrafts("t", { title: "t", drafts: [{ slotId: open[0].id, text: "a" }], open }, q);
    expect(res.refused[0].reason).toMatch(/did not answer/);
    expect(calls.some((c) => c.query.includes("createPost"))).toBe(false);
  });
});

describe("groupByChannel", () => {
  it("never puts two posts for one channel, or two organizations, in one group", () => {
    const items = [
      { slot: slot("x", MON) },
      { slot: slot("x", TUE) },
      { slot: slot("li", MON, { organizationId: "org2" }) },
      { slot: slot("bs", TUE) },
    ];
    const groups = groupByChannel(items).map((g) => g.map((i) => `${i.slot.organizationId}/${i.slot.channelId}`));
    expect(groups).toEqual([["org1/x", "org1/bs"], ["org1/x"], ["org2/li"]]);
  });
});

describe("daily posting limits", () => {
  it("checks once per organization and time, with every channel at that time", async () => {
    const { q, limitCalls } = fakeBuffer(ok);
    await saveDrafts("t", { title: "w", drafts: open.map((x) => ({ slotId: x.id, text: "hi" })), open }, q);
    expect(limitCalls.map((c) => c.variables.input)).toEqual([
      { channelIds: ["x", "li"], date: MON },
      { channelIds: ["x", "bs"], date: TUE },
    ]);
  });

  it("refuses a slot whose channel is at its limit, with Buffer's numbers, and saves the rest", async () => {
    const { q, calls } = fakeBuffer(ok, (c) => ({
      dailyPostingLimits: c.variables.input.channelIds.map((channelId: string) => ({ channelId, isAtLimit: channelId === "x" && c.variables.input.date === MON, limit: 17, scheduled: 15, sent: 2 })),
    }));
    const res = await saveDrafts("t", { title: "w", drafts: open.map((x) => ({ slotId: x.id, text: "hi" })), open }, q);
    expect(res.refused).toEqual([{ slotId: `x@${MON}`, reason: "X is at its daily posting limit in Buffer for that time (17 of 17 posts). Pick another slot." }]);
    expect(res.saved).toHaveLength(3);
    expect(calls.flatMap((c) => c.variables.input.posts.map((p: any) => `${p.channelId}@${p.dueAt}`))).not.toContain(`x@${MON}`);
  });

  it("does not block saving when the check itself fails", async () => {
    const { q } = fakeBuffer(ok, () => new Error("Buffer could not be reached"));
    const res = await saveDrafts("t", { title: "w", drafts: [{ slotId: open[0].id, text: "hi" }], open }, q);
    expect(res.saved).toHaveLength(1);
  });

  it(`checks at most ${MAX_LIMIT_CHECKS} distinct times per save`, async () => {
    const many = Array.from({ length: MAX_LIMIT_CHECKS + 3 }, (_, i) => slot("x", new Date(Date.UTC(2026, 10, 2 + i, 9)).toISOString()));
    const { q, limitCalls } = fakeBuffer(ok);
    await saveDrafts("t", { title: "w", drafts: many.map((x) => ({ slotId: x.id, text: "hi" })), open: many }, q);
    expect(limitCalls).toHaveLength(MAX_LIMIT_CHECKS);
  });
});

describe("saveDrafts checks platform facts only", () => {
  it("saves wording a style rule would object to: the playbook is judged before this step, by a model", async () => {
    const { q } = fakeBuffer(ok);
    const res = await saveDrafts("t", { title: "v1.4", drafts: [{ slotId: open[0].id, text: "Excited to share v1.4!" }], open }, q);
    expect(res.saved.length).toBe(1);
  });
});

describe("saveDrafts reports what it wrote", () => {
  it("returns each saved draft's Buffer post id, network and exact text, so edits can be read back later", async () => {
    const { q } = fakeBuffer((call) => ({
      createContentItem: { __typename: "CreateContentItemSuccess", content: { id: "ci", body: { __typename: "PostContent", posts: call.variables.input.posts.map((p: { channelId: string }, i: number) => ({ id: `post-${i}`, channelId: p.channelId })) } } },
    }));
    const res = await saveDrafts("t", { title: "v1.4", drafts: [{ slotId: open[0].id, text: "CSV export is live" }, { slotId: open[1].id, text: "CSV export, now live" }], open }, q);
    expect(res.saved).toEqual(expect.arrayContaining([
      expect.objectContaining({ slotId: open[0].id, postId: "post-0", network: "twitter", text: "CSV export is live" }),
    ]));
  });

  it("returns the post id from the one-by-one fallback too", async () => {
    const { q } = fakeBuffer((call) => (call.query.includes("createContentItem") ? new Error("Cannot query field createContentItem") : { createPost: { __typename: "PostActionSuccess", post: { id: "solo" } } }));
    const res = await saveDrafts("t", { title: "v1.4", drafts: [{ slotId: open[0].id, text: "CSV export is live" }], open }, q);
    expect(res.saved[0]).toMatchObject({ postId: "solo", network: "twitter", text: "CSV export is live" });
  });

  it("still saves when Buffer does not say which post is which", async () => {
    const { q } = fakeBuffer(ok);
    const res = await saveDrafts("t", { title: "v1.4", drafts: [{ slotId: open[0].id, text: "CSV export is live" }], open }, q);
    expect(res.saved[0]).toMatchObject({ slotId: open[0].id, postId: null });
  });
});

describe("saveDrafts when Buffer does not answer", () => {
  const timeout = () => Object.assign(new TypeError("fetch failed"), { cause: "timeout" });
  const draft = { slotId: open[0].id, text: "CSV export is live" };
  /** Answers the write with a network failure and the read-back with whatever posts the test gives. */
  const lostWrite = (found: unknown[]) => fakeBuffer((c) =>
    c.query.includes("posts(") ? { posts: { edges: found.map((node) => ({ node })) } } : timeout());

  it("reads back and reports the draft as saved when Buffer did create it, so the next fill does not duplicate it", async () => {
    const { q, calls } = lostWrite([{ id: "p9", channelId: "x", status: "draft", text: "CSV export is live", dueAt: MON }]);
    const r = await saveDrafts("t", { title: "v1.4", drafts: [draft], open }, q);
    expect(r.saved).toMatchObject([{ slotId: open[0].id, postId: "p9" }]);
    expect(r.refused).toEqual([]);
    const readBack = calls.find((c) => c.query.includes("posts("))!;
    expect(readBack.variables.input.filter).toMatchObject({ channelIds: ["x"] });
    expect(calls.filter((c) => !c.query.includes("posts("))).toHaveLength(1);
  });

  it("refuses with a plain reason when the read-back finds nothing", async () => {
    const { q } = lostWrite([]);
    const r = await saveDrafts("t", { title: "v1.4", drafts: [draft], open }, q);
    expect(r.saved).toEqual([]);
    expect(r.refused[0].reason).toMatch(/did not answer/i);
  });

  it("does not count a different draft in the same slot as this one", async () => {
    const { q } = lostWrite([{ id: "p1", channelId: "x", status: "draft", text: "Someone else's draft", dueAt: MON }]);
    const r = await saveDrafts("t", { title: "v1.4", drafts: [draft], open }, q);
    expect(r.saved).toEqual([]);
  });

  it("says the outcome is unknown when the read-back fails too, instead of claiming nothing was saved", async () => {
    const { q } = fakeBuffer(() => timeout());
    const r = await saveDrafts("t", { title: "v1.4", drafts: [draft], open }, q);
    expect(r.refused[0].reason).toMatch(/check Buffer before trying again/i);
  });

  it("does not read back when Buffer answered with its own refusal (control)", async () => {
    const { q, calls } = fakeBuffer(() => ({ createContentItem: { __typename: "InvalidInputError", message: "Text is required" } }));
    await saveDrafts("t", { title: "v1.4", drafts: [draft], open }, q);
    expect(calls.some((c) => c.query.includes("posts("))).toBe(false);
  });
});
