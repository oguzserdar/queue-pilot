/**
 * @fileoverview How the reply run reads and sends: a read with more than it may answer, refused reads, running again, waits the
 * network asks for, a cooldown shared with posts, replies turned off mid-draft, Bluesky sessions and backlogs, and old
 * mentions.
 * The reply run on PGlite with the real migrations, against fake Mastodon and Bluesky servers (src/test/reply-run-setup.ts).
 */
import { describe, expect, it, vi } from "vitest";
import { B, M, USER, get, inboundCount, later, net, outbound, pg, post, records, run, setReplies, statusesPosted } from "@/test/reply-run-setup";
import type { Bnote, ReplyRunDeps } from "@/test/reply-run-setup";

vi.mock("@/db", async () => { const { testDb } = await import("@/test/reply-run-db"); return { db: () => testDb, hasDatabase: () => true }; });

describe("a read with more than it may answer", () => {
  it("answers 20, then the rest on the next read, none twice", async () => {
    // Each reply row gets its own millisecond, as real claims do. With one frozen time for all 25, two Bluesky record
    // keys share their time part and collide 1 time in 1,024 per pair (the known record-key follow-up).
    const tick = { draft: async () => { net.now = new Date(net.now.getTime() + 1); return "Thanks for asking!"; } };
    await run();
    later();
    net.notes = Array.from({ length: 25 }, (_, i) => ({ id: String(100 + i), acct: `p${i}@far.example`, text: `q${i}` }));
    net.bnotes = Array.from({ length: 25 }, (_, i) => ({ uri: `at://x/many-${i}`, did: `did:plc:p${i}`, text: `q${i}` }));
    expect(await run(tick)).toMatchObject({ sent: 40 });
    later();
    expect(await run(tick)).toMatchObject({ sent: 10 });
    later();
    expect(await run(tick)).toMatchObject({ sent: 0 });
    expect(new Set(statusesPosted.map((s) => s.in_reply_to_id)).size).toBe(25);
    expect(statusesPosted).toHaveLength(25);
    expect(new Set(records.map((r) => (r.record.reply as { parent: { uri: string } }).parent.uri)).size).toBe(25);
    expect(records).toHaveLength(25);
  });

  it("starts no new answer once the run has used its time, and the next run picks up the rest", async () => {
    await pg.query(`update qp_social_account set replies_on = false where id = $1`, [B]);
    await run();
    later();
    net.notes = Array.from({ length: 5 }, (_, i) => ({ id: String(200 + i), acct: `t${i}@far.example`, text: `q${i}` }));
    // Each draft takes 15 seconds of the run's clock.
    const slow = { draft: async () => { net.now = new Date(net.now.getTime() + 15_000); return "ok"; } };
    const first = await run(slow);
    expect(first.sent).toBeGreaterThan(0);
    expect(first.sent).toBeLessThan(5);
    later();
    expect((await run(slow)).sent).toBe(5 - first.sent);
    expect(new Set(statusesPosted.map((s) => s.in_reply_to_id)).size).toBe(5);
    expect(statusesPosted).toHaveLength(5);
  });
});

describe("a refused read", () => {
  const brokenAt = async (id: string) => (await pg.query<{ broken: boolean }>(`select broken_at is not null as broken from qp_social_account where id = $1`, [id])).rows[0].broken;

  it("does not mark the account broken on a 403 (a token without read:notifications still posts)", async () => {
    await run();
    later();
    const forbidden: NonNullable<ReplyRunDeps["get"]> = async (url) =>
      url.origin === "https://m.example" ? Response.json({ error: "This action is outside the authorized scopes" }, { status: 403 }) : get(url, { headers: {} });
    await run({ get: forbidden });
    expect(await brokenAt(M)).toBe(false);
  });

  it("marks the account broken on a 401", async () => {
    await run();
    later();
    const unauthorized: NonNullable<ReplyRunDeps["get"]> = async (url) =>
      url.origin === "https://m.example" ? Response.json({ error: "The access token is invalid" }, { status: 401 }) : get(url, { headers: {} });
    await run({ get: unauthorized });
    expect(await brokenAt(M)).toBe(true);
  });
});

describe("running again", () => {
  it("answers each mention once across runs", async () => {
    await run();
    later();
    net.notes = [{ id: "70", acct: "bob@far.example", text: "q" }];
    net.bnotes = [{ uri: "at://x/q", did: "did:plc:bob", text: "q" }];
    expect(await run()).toMatchObject({ sent: 2 });
    later();
    expect(await run()).toMatchObject({ sent: 0 });
    expect(statusesPosted).toHaveLength(1);
    expect(records).toHaveLength(1);
  });

  it("does not read an account again before its gap has passed", async () => {
    await run();
    net.mastodonGets = 0; net.blueskyGets = 0;
    await run();
    expect(net.mastodonGets + net.blueskyGets).toBe(0);
  });
});

describe("a reply the network asked to wait on", () => {
  it("is put back, not failed, and the sweeper sends it once after the wait, on both networks", async () => {
    await run();
    later();
    net.notes = [{ id: "80", acct: "bob@far.example", text: "q", visibility: "unlisted" }];
    net.bnotes = [{ uri: "at://x/w", did: "did:plc:bob", text: "q", root: { uri: "at://x/root", cid: "cid-root" } }];
    let busy = true;
    const waiting: typeof post = async (url, init) => {
      const u = url.toString();
      if (busy && (u.endsWith("/api/v1/statuses") || u.endsWith("createRecord"))) {
        return Response.json({ error: "Too many requests" }, { status: 429, headers: { "retry-after": "60", "x-ratelimit-reset": new Date(net.now.getTime() + 60_000).toISOString() } });
      }
      return post(url, init);
    };
    expect(await run({ post: waiting })).toMatchObject({ sent: 0, failed: 0 });
    expect(await outbound()).toHaveLength(2);
    expect((await outbound()).every((o) => o.decision === null)).toBe(true);
    busy = false;
    later();
    net.notes = []; net.bnotes = [];
    expect(await run({ post: waiting })).toMatchObject({ sent: 2 });
    expect(statusesPosted).toHaveLength(1);
    expect(statusesPosted[0]).toMatchObject({ in_reply_to_id: "s80", visibility: "unlisted" });
    expect(records).toHaveLength(1);
    expect(records[0].record).toMatchObject({ reply: { parent: { uri: "at://x/w", cid: "cid-at://x/w" }, root: { uri: "at://x/root", cid: "cid-root" } } });
    later();
    expect(await run()).toMatchObject({ sent: 0 });
  });
});

describe("a cooldown shared with posts", () => {
  it("makes no reply call while a post's wait holds the account, then sends after it", async () => {
    const { postgresCooldowns } = await import("./cooldowns");
    const { repliesOwnerKey } = await import("./social-accounts");
    const cooldowns = postgresCooldowns();
    await run({ cooldowns });
    later();
    net.notes = [{ id: "90", acct: "bob@far.example", text: "q", visibility: "unlisted" }];
    net.bnotes = [];
    // A post to this account was just told to wait 5 minutes.
    await cooldowns.note(repliesOwnerKey({ network: "mastodon", server: "https://m.example", accountId: "100" }), new Date(net.now.getTime() + 5 * 60_000));
    expect(await run({ cooldowns })).toMatchObject({ sent: 0, failed: 0 });
    expect(statusesPosted).toHaveLength(0);
    // The account is skipped whole while cooling, so the mention is read only after the wait (Mastodon keeps it).
    later();
    expect(await run({ cooldowns })).toMatchObject({ sent: 1 });
    expect(statusesPosted).toHaveLength(1);
  });

  it("skips the whole account during a cooldown: no read, no draft, no AI; afterwards one draft and one send", async () => {
    const { postgresCooldowns } = await import("./cooldowns");
    const { repliesOwnerKey } = await import("./social-accounts");
    const cooldowns = postgresCooldowns();
    await run({ cooldowns });
    later();
    net.notes = [{ id: "95", acct: "bob@far.example", text: "q", visibility: "unlisted" }];
    net.bnotes = [];
    await cooldowns.note(repliesOwnerKey({ network: "mastodon", server: "https://m.example", accountId: "100" }), new Date(net.now.getTime() + 5 * 60_000));
    let drafts = 0;
    const counting = { cooldowns, draft: async () => { drafts += 1; return "Thanks for asking!"; } };
    net.mastodonGets = 0;
    await run(counting);
    expect(net.mastodonGets).toBe(0);
    expect(drafts).toBe(0);
    later();
    await run(counting);
    expect(drafts).toBe(1);
    expect(statusesPosted).toHaveLength(1);
  });

  it("control: a reply told to wait holds the account for the next one too", async () => {
    const { postgresCooldowns } = await import("./cooldowns");
    const { repliesOwnerKey } = await import("./social-accounts");
    const cooldowns = postgresCooldowns();
    await run({ cooldowns });
    later();
    net.notes = [{ id: "91", acct: "bob@far.example", text: "q", visibility: "unlisted" }];
    net.bnotes = [];
    const busy: typeof post = async (url, init) => url.toString().endsWith("/api/v1/statuses") ? Response.json({ error: "slow" }, { status: 429, headers: { "retry-after": "120" } }) : post(url, init);
    await run({ cooldowns, post: busy });
    expect(await cooldowns.active(repliesOwnerKey({ network: "mastodon", server: "https://m.example", accountId: "100" }), net.now)).not.toBeNull();
  });
});

describe("turning replies off while a reply is being drafted", () => {
  it("sends nothing once replies are off or the account is gone, even mid-draft", async () => {
    await run();
    later();
    net.notes = [{ id: "90", acct: "bob@far.example", text: "q" }];
    net.bnotes = [{ uri: "at://x/off", did: "did:plc:bob", text: "q" }];
    const draft = async () => {
      // The owner turns Mastodon replies off and disconnects Bluesky while the AI is still writing.
      await setReplies(USER, M, false);
      await pg.query(`delete from qp_social_account where id = $1`, [B]);
      return "Thanks for asking!";
    };
    const sum = await run({ draft });
    expect(statusesPosted).toHaveLength(0);
    expect(records).toHaveLength(0);
    expect(sum.sent).toBe(0);
  });
});

describe("a Bluesky session that cannot be renewed when the reply goes out", () => {
  it("puts the reply back, never uncertain or failed, and sends it once when signing in works again", async () => {
    await run();
    later();
    net.bnotes = [{ uri: "at://x/renew", did: "did:plc:bob", text: "q" }];
    let expired = true;
    let down = true;
    const flaky: typeof post = async (url, init) => {
      const u = url.toString();
      if (expired && u.endsWith("createRecord")) { expired = false; return Response.json({ error: "ExpiredToken", message: "Token has expired" }, { status: 400 }); }
      if (!expired && down && u.endsWith("createSession")) throw new TypeError("fetch failed");
      return post(url, init);
    };
    expect(await run({ post: flaky })).toMatchObject({ sent: 0, failed: 0 });
    expect(records).toHaveLength(0);
    expect((await outbound()).map((o) => o.decision)).toEqual([null]);
    down = false;
    later();
    net.bnotes = [];
    net.now = new Date(net.now.getTime() + 2 * 60_000);
    expect(await run({ post: flaky })).toMatchObject({ sent: 1 });
    expect(records).toHaveLength(1);
  });
});

describe("a Bluesky backlog longer than one read follows", () => {
  it("records every mention exactly once across reads, with new ones arriving in between", async () => {
    await run();
    later();
    const t0 = net.now.getTime();
    // Newest first, two to a page, so 14 mentions are 7 pages: more than one read follows (MAX_PAGES).
    let feed: Bnote[] = Array.from({ length: 14 }, (_, i) => ({ uri: `at://x/b${i}`, did: "did:plc:bob", text: `q${i}`, at: new Date(t0 - (i + 1) * 1000).toISOString() }));
    // The cursor is a time, as on Bluesky (notification/util.ts delayCursor): the next page is what is older than it.
    net.blueskyPage = (cursor) => {
      const older = cursor ? feed.filter((n) => n.at! < cursor) : feed;
      const page = older.slice(0, 2);
      return { notifications: page, cursor: older.length > 2 ? page[page.length - 1].at : undefined };
    };
    let recorded = 0;
    for (let i = 0; i < 8; i += 1) {
      net.blueskyGets = 0;
      recorded += (await run()).recorded;
      if (i === 0) feed = [{ uri: "at://x/new1", did: "did:plc:bob", text: "n1", at: new Date(t0 + 1000).toISOString() }, { uri: "at://x/new2", did: "did:plc:bob", text: "n2", at: new Date(t0 + 500).toISOString() }, ...feed];
      later();
    }
    expect(recorded).toBe(16);
    expect(await inboundCount()).toBe(16);
    // Pages read again after a backlog is worked through never answer a mention twice.
    expect(new Set(records.map((r) => r.rkey)).size).toBe(records.length);
    expect(Number((await pg.query<{ n: string }>(`select count(*) as n from qp_message where direction = 'out'`)).rows[0].n)).toBe(16);
  });
});

describe("mentions older than a day", () => {
  it("are not answered when reading catches up after an outage, on both networks", async () => {
    await run();
    net.now = new Date(net.now.getTime() + 3 * 24 * 3_600_000);
    const old = new Date(net.now.getTime() - 30 * 3_600_000).toISOString();
    const fresh = new Date(net.now.getTime() - 3_600_000).toISOString();
    net.bnotes = [{ uri: "at://x/fresh", did: "did:plc:bob", text: "q", at: fresh }, { uri: "at://x/old", did: "did:plc:bob", text: "q", at: old }];
    net.notes = [{ id: "70", acct: "bob@far.example", text: "q", at: old }, { id: "71", acct: "bob@far.example", text: "q", at: fresh }];
    const sum = await run();
    expect(records).toHaveLength(1);
    expect(statusesPosted).toHaveLength(1);
    expect(sum.sent).toBe(2);
  });
});
