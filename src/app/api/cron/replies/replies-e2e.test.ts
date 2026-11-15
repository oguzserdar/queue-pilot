/**
 * @fileoverview Replies through the real cron route, reply run, reply engine, Postgres stores (PGlite with the real
 * migrations), account reader, drafter and network clients. Faked: safeGet and safePost at the network edge, and the
 * owner's AI model (a test language model), since with no AI every reply is held. One Mastodon mention and one Bluesky
 * mention are each answered once; the next run answers nothing.
 */
import { encryptSecret } from "@/lib/secrets";
import { answering } from "@/lib/ai-test-model";
import { migratedPglite } from "@/test/migrated-pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const settingsKey = "56".repeat(32);
const cronSecret = "test-replies-cron-secret";
vi.stubEnv("DATABASE_URL", "postgres://test@localhost/unused");
vi.stubEnv("SETTINGS_KEY", settingsKey);
vi.stubEnv("CRON_SECRET", cronSecret);

const pg = await migratedPglite();
const testDb = drizzle(pg, { schema: { ...(await import("@/db/schema")), ...(await import("@/db/auth-schema")) } });
vi.mock("@/db", () => ({ db: () => testDb, hasDatabase: () => true }));
vi.mock("@/lib/safe-fetch", async (original) => {
  const actual = await original<typeof import("@/lib/safe-fetch")>();
  return { ...actual, safeGet: vi.fn<typeof actual.safeGet>(), safePost: vi.fn<typeof actual.safePost>() };
});
const model = answering("Thanks, it ships on Friday.");
vi.mock("@/lib/judge-model", async (original) => {
  const actual = await original<typeof import("@/lib/judge-model")>();
  return {
    ...actual,
    aiFor: async () => ({ cfg: { provider: "openai", key: "k", model: "m" }, source: "your key", language: model, decider: null, settle: async () => {}, giveBack: async () => {} }),
  };
});

const { GET } = await import("./route");
const { safeGet, safePost } = await import("@/lib/safe-fetch");
const { tidFor } = await import("@/lib/bluesky");
const get = vi.mocked(safeGet);
const post = vi.mocked(safePost);

const userId = "replies-e2e-user";
const did = "did:plc:repliese2eada";
const cronUrl = "https://app.example/api/cron/replies";
const runCron = async () => {
  const res = await GET(new Request(cronUrl, { headers: { authorization: `Bearer ${cronSecret}` } }));
  expect(res.status).toBe(200);
  return res.json();
};

const T0 = new Date("2026-11-15T10:00:00Z");
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);
let notes: unknown[] = [];
let bnotes: unknown[] = [];

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);
  await pg.query(`insert into "user" (id, name, email) values ($1, 'Ada', 'ada@replies-e2e.example')`, [userId]);
  await pg.query(
    `insert into qp_social_account (id, user_id, network, account_id, handle, server, credentials, scopes, replies_on) values
     ('e2e-m', $1, 'mastodon', '100', '@ada@m.example', 'https://m.example', $2, 'read:notifications write:statuses', true),
     ('e2e-b', $1, 'bluesky', $3, 'ada.bsky.social', 'https://pds.example', $4, '', true)`,
    [userId, encryptSecret(JSON.stringify({ token: "mastodon-token" }), settingsKey), did, encryptSecret(JSON.stringify({ identifier: "ada.bsky.social", appPassword: "app-pass" }), settingsKey)],
  );
  get.mockImplementation(async (url) => {
    if (url.toString().startsWith("https://m.example/api/v1/notifications")) {
      const minId = url.searchParams.get("min_id");
      const page = (notes as { id: string }[]).filter((n) => !minId || Number(n.id) > Number(minId)).reverse();
      return Response.json(page, page.length ? { headers: { link: `<https://m.example/api/v1/notifications?min_id=${page[0].id}>; rel="prev"` } } : undefined);
    }
    if (url.toString().startsWith("https://pds.example/xrpc/app.bsky.notification.listNotifications")) return Response.json({ notifications: bnotes });
    throw new Error(`Unexpected GET ${url}`);
  });
  post.mockImplementation(async (url, init) => {
    const u = url.toString();
    if (u === "https://m.example/api/v1/statuses") return Response.json({ id: "9001", url: "https://m.example/@ada/9001" });
    if (u === "https://pds.example/xrpc/com.atproto.server.createSession") return Response.json({ did, accessJwt: "jwt" });
    if (u === "https://pds.example/xrpc/com.atproto.repo.createRecord") return Response.json({ uri: `at://${did}/app.bsky.feed.post/${JSON.parse(init.body).rkey}`, cid: "c" });
    throw new Error(`Unexpected POST ${u}`);
  });
});

afterAll(async () => {
  vi.useRealTimers();
  try {
    await pg.close();
  } finally {
    vi.unstubAllEnvs();
  }
});

const calls = (u: string) => post.mock.calls.filter(([url]) => url.toString() === u);

describe("replies through GET /api/cron/replies", () => {
  it("refuses a request without the bearer secret before reading anything", async () => {
    expect((await GET(new Request(cronUrl))).status).toBe(401);
    expect(get).not.toHaveBeenCalled();
  });

  it("answers one Mastodon and one Bluesky mention once, and nothing on the next run", async () => {
    notes = [{ id: "1", type: "mention", status: { id: "s-old", account: { id: "7", acct: "bob@far.example" }, content: "<p>old</p>", url: null, uri: "x", created_at: at(-60).toISOString(), visibility: "public", in_reply_to_id: null } }];
    bnotes = [{ uri: "at://did:plc:carl/app.bsky.feed.post/old", cid: "c-old", author: { did: "did:plc:carl", handle: "carl.bsky.social" }, reason: "mention", record: { text: "old" }, isRead: true, indexedAt: at(-60).toISOString() }];
    expect(await runCron()).toMatchObject({ accounts: 2, primed: 2, sent: 0 });
    expect(calls("https://m.example/api/v1/statuses")).toHaveLength(0);
    expect(calls("https://pds.example/xrpc/com.atproto.repo.createRecord")).toHaveLength(0);

    vi.setSystemTime(at(11));
    notes.push({ id: "2", type: "mention", status: { id: "s-new", account: { id: "7", acct: "bob@far.example" }, content: "<p>@ada when does it ship?</p>", url: "https://far.example/@bob/2", created_at: at(5).toISOString(), visibility: "unlisted", in_reply_to_id: null } });
    bnotes = [
      { uri: "at://did:plc:carl/app.bsky.feed.post/new", cid: "c-new", author: { did: "did:plc:carl", handle: "carl.bsky.social" }, reason: "mention", record: { text: "@ada.bsky.social when?" }, isRead: false, indexedAt: at(6).toISOString() },
      ...bnotes,
    ];
    expect(await runCron()).toMatchObject({ accounts: 2, recorded: 2, sent: 2, held: 0 });

    const statuses = calls("https://m.example/api/v1/statuses");
    expect(statuses).toHaveLength(1);
    expect(JSON.parse(statuses[0][1].body)).toEqual({ status: "@bob@far.example Thanks, it ships on Friday.", in_reply_to_id: "s-new", visibility: "unlisted" });
    expect(new Headers(statuses[0][1].headers).get("authorization")).toBe("Bearer mastodon-token");

    const created = calls("https://pds.example/xrpc/com.atproto.repo.createRecord");
    expect(created).toHaveLength(1);
    const body = JSON.parse(created[0][1].body);
    const { rows: [row] } = await pg.query<{ id: string; at: Date }>(`select id, at from qp_message where direction = 'out' and channel = 'bluesky'`);
    expect(body).toMatchObject({
      repo: did, collection: "app.bsky.feed.post", rkey: tidFor(row.id, new Date(row.at)),
      record: { text: "Thanks, it ships on Friday.", reply: { root: { uri: "at://did:plc:carl/app.bsky.feed.post/new", cid: "c-new" }, parent: { uri: "at://did:plc:carl/app.bsky.feed.post/new", cid: "c-new" } } },
    });
    const { rows: out } = await pg.query(`select channel, decision, text from qp_message where direction = 'out' order by channel`);
    expect(out).toEqual([
      { channel: "bluesky", decision: "sent", text: "Thanks, it ships on Friday." },
      { channel: "mastodon", decision: "sent", text: "@bob@far.example Thanks, it ships on Friday." },
    ]);

    vi.setSystemTime(at(22));
    expect(await runCron()).toMatchObject({ accounts: 2, recorded: 0, sent: 0 });
    expect(calls("https://m.example/api/v1/statuses")).toHaveLength(1);
    expect(calls("https://pds.example/xrpc/com.atproto.repo.createRecord")).toHaveLength(1);
  });
});
