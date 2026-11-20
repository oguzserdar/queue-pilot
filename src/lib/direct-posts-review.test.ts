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
    const post = vi.fn<DirectPostDeps["post"]>(async () => ({ link: null }));
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
    // The wait asked for, plus up to a tenth more (jitter), so many waiting posts do not come back at the same second.
    at(plus(AT, 34_000));
    await runDue(d);
    expect(sent).toEqual(["telegram"]);
  });

  it("stops after 5 waits: the next wait fails the post with the reason, instead of waiting forever", async () => {
    const { d, sent, at } = setup({ post: async () => { throw new Refusal("Too Many Requests", 30); } });
    await scheduleDirectPost("u1", "form-0040", [tg], AT, d);
    const results = [];
    for (let i = 1; i <= 7; i++) { at(plus(AT, i * 3_600_000)); results.push(...(await runDue(d))); }
    expect(results.map((r) => r.status)).toEqual(["scheduled", "scheduled", "scheduled", "scheduled", "scheduled", "failed"]);
    expect(results.at(-1)?.error).toBe("Telegram asked to wait 5 times in a row, so this was not sent. Send it again when you are ready.");
    expect(sent).toEqual([]);
  });

  it("control: a wait under the ceiling never adds more than a tenth of the wait", async () => {
    const { d, at } = setup({ post: async () => { throw new Refusal("Too Many Requests", 100); } });
    await scheduleDirectPost("u1", "form-0041", [tg], AT, d);
    at(plus(AT, 1_000));
    await runDue(d);
    const [row] = await d.store.rows("u1", (await d.store.recent("u1", 1))[0].postId);
    const waited = (row.claimedUntil!.getTime() - plus(AT, 1_000).getTime()) / 1000;
    expect(waited).toBeGreaterThanOrEqual(100);
    expect(waited).toBeLessThanOrEqual(110);
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
    expect(await resendFailed("u1", id, { kind: "telegram", target: "" }, d)).toBeNull();
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
    await d.store.finish("u1", row.postId, { kind: "telegram", target: "" }, { status: "failed", link: null, error: "late worker" }, new Date());
    expect((await d.store.recent("u1", 1))[0].status).toBe("sent");
  });
});

describe("run deadline", () => {
  it("stops starting sends at the deadline, and the next run takes the rest at once", async () => {
    const { d, sent, at } = setup();
    for (const n of ["0050", "0051", "0052"]) await scheduleDirectPost("u1", `form-${n}`, [{ ...tg, text: `Post ${n}` }], AT, d);
    at(plus(AT, 1_000));
    // The deadline has already passed when the run starts: it claims, sends nothing, and gives the claims back.
    expect(await runDue(d, { deadline: plus(AT, 500) })).toEqual([]);
    expect(sent).toEqual([]);
    at(plus(AT, 2_000));
    expect((await runDue(d)).map((r) => r.status)).toEqual(["sent", "sent", "sent"]);
  });

  it("control: a send-now post given back at the deadline is still taken by the next run", async () => {
    const { d, sent, at } = setup();
    // A send-now row has no send time; giving it back must not leave it waiting for one.
    await d.store.claim("u1", "now-1", tg, plus(AT, -10 * 60_000));
    at(plus(AT, 1_000));
    expect(await runDue(d, { deadline: plus(AT, 500) })).toEqual([]);
    at(plus(AT, 2_000));
    await runDue(d);
    expect(sent).toEqual(["telegram"]);
  });
});

describe("the wait ceiling on a follow-up", () => {
  it("does not offer to send it again, since a follow-up is changed on its Buffer draft", async () => {
    const { d, at } = setup({ post: async () => { throw new Refusal("Too Many Requests", 30); } });
    const id = await followUpIdFor("u1", "bp9");
    await d.store.follow("u1", id, tg, AT, new Date(), "bp9");
    const results = [];
    for (let i = 1; i <= 7; i++) { at(plus(AT, i * 3_600_000)); results.push(...(await runDue(d))); }
    expect(results.at(-1)?.error).toBe("Telegram asked to wait 5 times in a row, so this was not sent.");
  });
});

describe("cooldown per account", () => {
  // A cooldown store in memory, and a key per place (the run's real keys come from each sender).
  const cooling = () => {
    const until = new Map<string, Date>();
    return {
      until,
      cooldowns: {
        key: async (item: PostItem) => `${item.kind}:${item.target}`,
        active: async (key: string, now: Date) => { const u = until.get(key); return u && u > now ? u : null; },
        note: async (key: string, u: Date) => { const old = until.get(key); if (!old || old < u) until.set(key, u); },
      },
    };
  };
  const m1 = { kind: "mastodon" as const, target: "m1", label: "@a", text: "One." };
  const m2 = { kind: "mastodon" as const, target: "m2", label: "@b", text: "Two." };

  it("holds every post to an account that was told to wait, without a call and without counting a wait", async () => {
    const calls: string[] = [];
    const c = cooling();
    let limitM1 = true;
    const { d, at } = setup({ post: async (item) => { calls.push(item.target); if (item.target === "m1" && limitM1) throw new Refusal("Too Many Requests", 300); return { link: null }; } });
    const dd = { ...d, cooldowns: c.cooldowns };
    await scheduleDirectPost("u1", "form-0060", [m1], AT, dd);
    await scheduleDirectPost("u1", "form-0061", [{ ...m1, text: "One again." }], AT, dd);
    await scheduleDirectPost("u1", "form-0062", [m2], AT, dd);
    at(plus(AT, 1_000));
    await runDue(dd);
    // m1 was called once, told to wait; the second m1 post made no call; m2 went out.
    expect(calls.sort((a, b) => a.localeCompare(b))).toEqual(["m1", "m2"]);
    const rows = (await Promise.all((await d.store.recent("u1", 10)).map((r) => d.store.rows("u1", r.postId)))).flat().filter((r) => r.target === "m1");
    expect(rows.map((r) => r.waits).sort((a, b) => a - b)).toEqual([0, 1]);
    limitM1 = false;
    at(plus(AT, 1_000 + 340_000));
    await runDue(dd);
    expect(calls.filter((t) => t === "m1")).toHaveLength(3);
  });

  it("control: a shorter wait never shortens a longer one", async () => {
    const c = cooling();
    await c.cooldowns.note("k", plus(AT, 600_000));
    await c.cooldowns.note("k", plus(AT, 60_000));
    expect(c.until.get("k")).toEqual(plus(AT, 600_000));
  });
});

describe("cooldown edges", () => {
  const cooling = () => {
    const until = new Map<string, Date>();
    return { until, cooldowns: {
      key: async (item: PostItem) => `${item.kind}:${item.target}`,
      active: async (key: string, now: Date) => { const u = until.get(key); return u && u > now ? u : null; },
      note: async (key: string, u: Date) => { const old = until.get(key); if (!old || old < u) until.set(key, u); },
    } };
  };
  const b1 = { kind: "bluesky" as const, target: "b1", label: "@a", text: "One." };

  it("checks the cooldown before getting ready, so a cooling account never signs in", async () => {
    const c = cooling();
    const readied: string[] = [];
    const { d, at } = setup({ ready: async (item) => { readied.push(item.target); } });
    const dd = { ...d, cooldowns: c.cooldowns };
    await c.cooldowns.note("bluesky:b1", plus(AT, 600_000));
    await scheduleDirectPost("u1", "form-0070", [b1], AT, dd);
    at(plus(AT, 1_000));
    await runDue(dd);
    expect(readied).toEqual([]);
  });

  it("holds the account when getting ready (signing in) is told to wait, instead of retrying at every claim", async () => {
    const c = cooling();
    const { d, at } = setup({ ready: async () => { throw new Refusal("Rate Limit Exceeded", 300); } });
    const dd = { ...d, cooldowns: c.cooldowns };
    await scheduleDirectPost("u1", "form-0071", [b1], AT, dd);
    at(plus(AT, 1_000));
    const [r] = await runDue(dd);
    expect(r.status).toBe("scheduled");
    expect(c.until.get("bluesky:b1")!.getTime()).toBeGreaterThanOrEqual(plus(AT, 301_000).getTime());
  });

  it("fails a post told to wait more than 6 hours, with the reason, and holds the account at most 6 hours", async () => {
    const c = cooling();
    const { d, at } = setup({ post: async () => { throw new Refusal("Too Many Requests", 365 * 86_400); } });
    const dd = { ...d, cooldowns: c.cooldowns };
    await scheduleDirectPost("u1", "form-0072", [b1], AT, dd);
    at(plus(AT, 1_000));
    const [r] = await runDue(dd);
    expect(r.status).toBe("failed");
    expect(r.error).toBe("Bluesky asked to wait more than 6 hours, so this was not sent. Send it again later.");
    expect(c.until.get("bluesky:b1")!.getTime()).toBeLessThanOrEqual(plus(AT, 1_000 + 6 * 3_600_000).getTime());
  });
});

describe("a wider wait", () => {
  it("holds another channel while a bot-wide wait lasts", async () => {
    const until = new Map<string, Date>();
    const cooldowns = {
      key: async (item: PostItem) => `discord channel ${item.target}`,
      wider: (_k: string, e?: unknown) => (e === undefined || (e as { global?: boolean })?.global ? "discord bot" : null),
      active: async (key: string, now: Date) => { const u = until.get(key); return u && u > now ? u : null; },
      note: async (key: string, u: Date) => { until.set(key, u); },
    };
    const calls: string[] = [];
    const { d, at } = setup({ post: async (item) => { calls.push(item.target); throw Object.assign(new Refusal("slow", 60), { global: true }); } });
    const dd = { ...d, cooldowns };
    await scheduleDirectPost("u1", "form-0080", [{ ...dc, target: "c1" }], AT, dd);
    await scheduleDirectPost("u1", "form-0081", [{ ...dc, target: "c2" }], plus(AT, 40_000), dd);
    at(plus(AT, 1_000));
    await runDue(dd);
    expect(until.has("discord bot")).toBe(true);
    // c2 is due while the bot-wide wait (60 s) still lasts: it is held, no call.
    at(plus(AT, 41_000));
    await runDue(dd);
    expect(calls).toEqual(["c1"]);
  });
});
