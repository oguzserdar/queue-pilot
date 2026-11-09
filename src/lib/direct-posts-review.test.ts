/**
 * @fileoverview The cases five independent reviews found: a place added later goes out on the post's newest timer; a
 * failure before the call never becomes "may have been sent"; a rate limit waits and sends; a follow-up gives up a day
 * late whatever Buffer says; one row's error never stops the rest; a follow-up is never resent around Buffer; a late
 * worker cannot overwrite a finished row.
 */
import { describe, expect, it, vi } from "vitest";
import { followUpIdFor, memoryDirectPostStore, resendFailed, runDue, scheduleDirectPost, sendDirectPost, type BufferState, type DirectPostDeps, type PostItem } from "./direct-posts";

class Refusal extends Error { constructor(m: string, readonly retryAfterSeconds?: number) { super(m); } }
const AT = new Date("2026-11-09T14:01:00Z");
const plus = (t: Date, ms: number) => new Date(t.getTime() + ms);
const tg: PostItem = { kind: "telegram", target: "-100", label: "News", text: "Issue 41 is out." };
const dc: PostItem = { kind: "discord", target: "c1", label: "TWiAI #new-issues", text: "Issue 41 is up.", guildId: "g1" };

function setup(opts: { buffer?: BufferState; post?: DirectPostDeps["post"]; ready?: DirectPostDeps["ready"] } = {}) {
  let now = new Date("2026-11-09T10:00:00Z");
  const sent: string[] = [];
  const d: DirectPostDeps = {
    store: memoryDirectPostStore(),
    post: opts.post ?? (async (item) => (sent.push(item.kind), { link: null })),
    ready: opts.ready,
    refused: (e) => e instanceof Refusal,
    bufferCheck: async (_u, ids) => new Map(ids.map((id) => [id, opts.buffer ?? { state: "sent" as const }])),
    now: () => now,
  };
  return { d, sent, at: (t: Date) => (now = t) };
}

describe("one post, several places", () => {
  it("sends a place added in a later save on the post's newest timer", async () => {
    const { d, sent, at } = setup();
    const id = await followUpIdFor("u1", "bp1");
    await d.store.follow("u1", id, tg, AT, new Date(), "bp1");
    await d.store.follow("u1", id, tg, AT, new Date(), "bp1");
    await d.store.follow("u1", id, dc, AT, new Date(), "bp1");
    const newest = Math.max(...(await d.store.rows("u1", id)).map((r) => r.revision));
    at(plus(AT, 1_000));
    await runDue(d, { only: { postId: id, revision: newest } });
    expect(sent.sort()).toEqual(["discord", "telegram"]);
  });

  it("an older timer still sends nothing after an edit", async () => {
    const { d, sent, at } = setup();
    const { postId, revision } = await scheduleDirectPost("u1", "form-0001", [tg], AT, d);
    await d.store.reschedule("u1", postId, { texts: { telegram: "Edited." } }, new Date());
    at(plus(AT, 1_000));
    expect(await runDue(d, { only: { postId, revision } })).toEqual([]);
    expect(sent).toEqual([]);
  });
});

describe("before the call", () => {
  it("fails a place that is no longer connected, without calling it", async () => {
    const post = vi.fn(async () => ({ link: null }));
    const { d } = setup({ post, ready: async () => { throw new Refusal("This Telegram channel was disconnected."); } });
    const { results } = await sendDirectPost("u1", "form-0002", [tg], d);
    expect(results[0]).toMatchObject({ status: "failed", error: "This Telegram channel was disconnected." });
    expect(post).not.toHaveBeenCalled();
  });

  it("keeps a place to send again when the check itself breaks, never 'may have been sent'", async () => {
    let broken = true;
    const { d, sent, at } = setup({ ready: async () => { if (broken) throw new Error("database is down"); } });
    vi.spyOn(console, "error").mockImplementation(() => {});
    await scheduleDirectPost("u1", "form-0003", [tg], AT, d);
    at(plus(AT, 1_000));
    await runDue(d);
    const [row] = await d.store.recent("u1", 5);
    expect(row.status).toBe("pending");
    expect(sent).toEqual([]);
    broken = false;
    at(plus(AT, 3 * 60_000));
    await runDue(d);
    expect(sent).toEqual(["telegram"]);
  });
});

describe("after the call", () => {
  it("waits as asked after a rate limit on a scheduled post, then sends it", async () => {
    let limited = true;
    const { d, sent, at } = setup({ post: async (item) => { if (limited) throw new Refusal("Too Many Requests", 30); sent.push(item.kind); return { link: null }; } });
    await scheduleDirectPost("u1", "form-0004", [tg], AT, d);
    at(plus(AT, 1_000));
    const [first] = await runDue(d);
    expect(first.status).toBe("scheduled");
    limited = false;
    at(plus(AT, 10_000));
    expect(await runDue(d)).toEqual([]);
    at(plus(AT, 32_000));
    await runDue(d);
    expect(sent).toEqual(["telegram"]);
  });

  it("never sends again after an unclear answer, and says so in the logs without the text", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const { d, at } = setup({ post: async () => { throw new Error("socket hang up at https://api.telegram.org/bot123:ABC-def/sendMessage"); } });
    await scheduleDirectPost("u1", "form-0005", [tg], AT, d);
    at(plus(AT, 1_000));
    const [r] = await runDue(d);
    expect(r.status).toBe("uncertain");
    at(plus(AT, 10 * 60_000));
    expect(await runDue(d)).toEqual([]);
    const line = String(log.mock.calls.at(-1)?.[0]);
    expect(line).toContain("qp-direct-post-uncertain");
    expect(line).not.toContain("ABC-def");
    expect(line).not.toContain(tg.text);
  });

  it("does not stop the run when one row breaks", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { d, sent, at } = setup();
    await scheduleDirectPost("u1", "form-0006", [tg], AT, d);
    await scheduleDirectPost("u2", "form-0007", [tg], AT, d);
    const start = d.store.startCall.bind(d.store);
    let first = true;
    d.store.startCall = async (...a) => { if (first) { first = false; throw new Error("deadlock"); } return start(...a); };
    at(plus(AT, 1_000));
    await runDue(d);
    expect(sent).toEqual(["telegram"]);
  });
});

describe("a place that follows a Buffer post", () => {
  it("gives up a day after its time when Buffer cannot be read, without moving its time", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { d, sent, at } = setup();
    d.bufferCheck = async () => { throw new Error("401 token revoked"); };
    const id = await followUpIdFor("u1", "bp1");
    await d.store.follow("u1", id, tg, AT, new Date(), "bp1");
    at(plus(AT, 1_000));
    const [held] = await runDue(d);
    expect(held.status).toBe("scheduled");
    expect((await d.store.rows("u1", id))[0].sendAt).toEqual(AT);
    at(plus(AT, 2 * 60_000));
    expect(await runDue(d)).toEqual([]);
    at(plus(AT, 25 * 3_600_000));
    const [gave] = await runDue(d);
    expect(gave).toMatchObject({ status: "failed", error: expect.stringMatching(/a day after/) });
    expect(sent).toEqual([]);
  });

  it("cannot be sent again from Sources after Buffer deleted the post", async () => {
    const { d, sent, at } = setup({ buffer: { state: "gone", reason: "The post was deleted in Buffer, so this was not sent." } });
    const id = await followUpIdFor("u1", "bp1");
    await d.store.follow("u1", id, tg, AT, new Date(), "bp1");
    at(plus(AT, 1_000));
    await runDue(d);
    expect(await resendFailed("u1", id, "telegram", d)).toBeNull();
    expect(sent).toEqual([]);
  });

  it("stops the automatic copy only for its own places, and not after giving up before any call", async () => {
    const { d, at } = setup({ buffer: { state: "gone", reason: "Deleted." } });
    const id = await followUpIdFor("u1", "bp1");
    await d.store.follow("u1", id, tg, AT, new Date(), "bp1");
    expect(await d.store.followedPlaces("u1", ["bp1"])).toEqual(new Set(["bp1|telegram"]));
    at(plus(AT, 1_000));
    await runDue(d);
    expect((await d.store.followedPlaces("u1", ["bp1"])).size).toBe(0);
  });
});

describe("reading Buffer for follow-ups", () => {
  it("reads all of one person's due follow-ups in one call", async () => {
    const { d, sent, at } = setup();
    const calls: string[][] = [];
    d.bufferCheck = async (_u, ids) => (calls.push(ids), new Map(ids.map((id) => [id, { state: "sent" as const }])));
    await d.store.follow("u1", await followUpIdFor("u1", "bp1"), tg, AT, new Date(), "bp1");
    await d.store.follow("u1", await followUpIdFor("u1", "bp2"), dc, AT, new Date(), "bp2");
    at(plus(AT, 1_000));
    await runDue(d);
    expect(calls.map((c) => c.sort())).toEqual([["bp1", "bp2"]]);
    expect(sent.sort()).toEqual(["discord", "telegram"]);
  });
});

describe("finishing a row", () => {
  it("leaves a row another run already finished as it is", async () => {
    const { d } = setup();
    const { results } = await sendDirectPost("u1", "form-0008", [tg], d);
    expect(results[0].status).toBe("sent");
    const [row] = await d.store.recent("u1", 1);
    await d.store.finish("u1", row.postId, "telegram", { status: "failed", link: null, error: "late worker" }, new Date());
    expect((await d.store.recent("u1", 1))[0].status).toBe("sent");
  });
});
