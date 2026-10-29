import { describe, expect, it } from "vitest";
import type { Post } from "./buffer/queries";
import { MAX_APPROVE, approveDrafts } from "./approve-drafts";
import { BufferRateLimitedError } from "./buffer/client";

const now = new Date("2026-11-01T12:00:00Z");
const post = (over: Partial<Post>): Post => ({
  id: "d1",
  channelId: "x",
  status: "draft",
  text: "hi",
  dueAt: "2026-11-02T09:00:00.000Z",
  sentAt: null,
  externalLink: null,
  error: null,
  ...over,
});

function fake(answer: (input: any) => unknown) {
  const inputs: any[] = [];
  const q = (async (_t: string, _query: string, vars?: any) => {
    inputs.push(vars.input);
    const a = answer(vars.input);
    if (a instanceof Error) throw a;
    return a;
  }) as any;
  return { q, inputs };
}
const success = () => ({ editPost: { __typename: "PostActionSuccess", post: { id: "d1", status: "scheduled" } } });

describe("approveDrafts", () => {
  it("schedules a draft at its own slot time", async () => {
    const { q, inputs } = fake(success);
    const res = await approveDrafts("t", ["d1"], [post({})], now, q);
    expect(res).toEqual({ approved: ["d1"], refused: [] });
    expect(inputs[0]).toEqual({ id: "d1", saveToDraft: false, mode: "customScheduled", dueAt: "2026-11-02T09:00:00.000Z" });
  });

  it("refuses ids that are not the caller's drafts, without calling Buffer", async () => {
    const { q, inputs } = fake(success);
    const res = await approveDrafts(
      "t",
      ["someone-elses", "s1", "old"],
      [post({ id: "s1", status: "scheduled" }), post({ id: "old", dueAt: "2026-10-31T09:00:00.000Z" })],
      now,
      q,
    );
    expect(res.approved).toEqual([]);
    expect(res.refused.map((r) => r.reason)).toEqual([
      "This post is no longer in your Buffer queue.",
      "This post is not a draft any more.",
      "Its time has passed; pick a new time in Buffer.",
    ]);
    expect(inputs).toEqual([]);
  });

  it("passes Buffer's own reason back, for example a posting limit", async () => {
    const { q } = fake(() => ({ editPost: { __typename: "LimitReachedError", message: "You have reached the daily posting limit for this channel." } }));
    const res = await approveDrafts("t", ["d1"], [post({})], now, q);
    expect(res.refused).toEqual([{ id: "d1", reason: "You have reached the daily posting limit for this channel." }]);
  });

  it("approves each id once even if it is sent twice", async () => {
    const { q, inputs } = fake(success);
    await approveDrafts("t", ["d1", "d1"], [post({})], now, q);
    expect(inputs).toHaveLength(1);
  });

  it("keeps going after one network error", async () => {
    let n = 0;
    const { q } = fake(() => (n++ === 0 ? new Error("Buffer API error (502)") : success()));
    const res = await approveDrafts("t", ["d1", "d2"], [post({}), post({ id: "d2" })], now, q);
    expect(res.approved).toEqual(["d2"]);
    expect(res.refused).toEqual([{ id: "d1", reason: "Buffer API error (502)" }]);
  });
});

describe("image links before approving", () => {
  const ok = () => ({ editPost: { __typename: "PostActionSuccess" } });
  const withImage = (over: Partial<Post> = {}) => post({ assets: [{ type: "image", mimeType: "image/png", source: "https://i.example/a.png" }], ...over });

  it("refuses a draft whose image link is broken, with the check's reason, and sends nothing for it", async () => {
    const { q, inputs } = fake(ok);
    const res = await approveDrafts("t", ["d1"], [withImage()], now, q, async () => ({ name: "Image link loads", result: "fail", detail: "The image link answered 404." }));
    expect(res).toEqual({ approved: [], refused: [{ id: "d1", reason: "The image link answered 404." }] });
    expect(inputs).toEqual([]);
  });

  it("approves when every image loads, and skips the check for text-only drafts", async () => {
    const { q } = fake(ok);
    const checked: string[] = [];
    const res = await approveDrafts("t", ["d1", "d2"], [withImage(), post({ id: "d2" })], now, q, async (url) => (checked.push(url), { name: "Image link loads", result: "pass", detail: "" }));
    expect(res.approved).toEqual(["d1", "d2"]);
    expect(checked).toEqual(["https://i.example/a.png"]);
  });
});

describe("limits", () => {
  it("stops at Buffer's rate limit and says which drafts are still waiting", async () => {
    let n = 0;
    const { q, inputs } = fake(() => (++n === 2 ? new BufferRateLimitedError(new Date("2026-11-01T13:00:00Z")) : { editPost: { __typename: "PostActionSuccess" } }));
    const posts = ["d1", "d2", "d3", "d4"].map((id) => post({ id }));
    const res = await approveDrafts("t", ["d1", "d2", "d3", "d4"], posts, now, q, async () => ({ name: "", result: "pass", detail: "" }));
    expect(res.approved).toEqual(["d1"]);
    expect(res.refused.map((r) => r.id)).toEqual(["d2", "d3", "d4"]);
    expect(res.refused[0].reason).toContain("request limit");
    // No further calls after the limit.
    expect(inputs).toHaveLength(2);
  });

  it(`approves at most ${MAX_APPROVE} per press`, async () => {
    const { q, inputs } = fake(() => ({ editPost: { __typename: "PostActionSuccess" } }));
    const ids = Array.from({ length: MAX_APPROVE + 2 }, (_, i) => `d${i}`);
    const res = await approveDrafts("t", ids, ids.map((id) => post({ id })), now, q, async () => ({ name: "", result: "pass", detail: "" }));
    expect(inputs).toHaveLength(MAX_APPROVE);
    expect(res.refused).toHaveLength(2);
  });
});
