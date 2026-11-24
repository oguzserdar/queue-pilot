/**
 * @fileoverview Bluesky posts through the real cron route, migrated Postgres store, sender registry, client and
 * account reader. Only safePost is faked at the network edge; the database connection points at PGlite.
 */
import { encryptSecret } from "@/lib/secrets";
import { migratedPglite } from "@/test/migrated-pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const settingsKey = "12".repeat(32);
const cronSecret = "test-bluesky-cron-secret";
vi.stubEnv("DATABASE_URL", "postgres://test@localhost/unused");
vi.stubEnv("SETTINGS_KEY", settingsKey);
vi.stubEnv("CRON_SECRET", cronSecret);

const pg = await migratedPglite();
const schema = { ...(await import("@/db/schema")), ...(await import("@/db/auth-schema")) };
const testDb = drizzle(pg, { schema });
vi.mock("@/db", () => ({ db: () => testDb, schema }));
vi.mock("@/lib/safe-fetch", async (original) => {
  const actual = await original<typeof import("@/lib/safe-fetch")>();
  return { ...actual, safePost: vi.fn<typeof actual.safePost>() };
});

const { GET } = await import("./route");
const { postgresDirectPostStore } = await import("@/lib/direct-post-store");
const { tidFor } = await import("@/lib/bluesky");
const { safePost } = await import("@/lib/safe-fetch");
const post = vi.mocked(safePost);
const store = postgresDirectPostStore();

const userId = "bluesky-e2e-user";
const accountId = "bluesky-e2e-account";
const postId = "bluesky-e2e-post";
const identifier = "ada.bsky.social";
const appPassword = "xxxx-xxxx-xxxx-xxxx";
const did = "did:plc:blueskye2eada";
const accessJwt = "test-bluesky-access-jwt";
const cronUrl = "https://app.example/api/cron/due";
const runCron = () => GET(new Request(cronUrl, { headers: { authorization: `Bearer ${cronSecret}` } }));
const storedRow = async () => (await store.rows(userId, postId))[0];

beforeAll(async () => {
  await pg.query(`insert into "user" (id, name, email) values ($1, 'Ada', 'ada@bluesky-e2e.example')`, [userId]);
});

beforeEach(async () => {
  post.mockReset();
  post.mockImplementation(async (url, init) => {
    if (url.toString() === "https://pds.example/xrpc/com.atproto.server.createSession") {
      return Response.json({ did, accessJwt });
    }
    if (url.toString() === "https://pds.example/xrpc/com.atproto.repo.createRecord") {
      const { rkey } = JSON.parse(init.body);
      return Response.json({ uri: `at://${did}/app.bsky.feed.post/${rkey}`, cid: "bafyreiblueskye2e" });
    }
    throw new Error(`Unexpected POST: ${url}`);
  });
  await pg.query(`delete from qp_announcement_send where user_id = $1`, [userId]);
  await pg.query(`delete from qp_announcement_send where user_id = $1`, [userId]);
  await pg.query(`delete from qp_social_account where user_id = $1`, [userId]);
  await pg.query(
    `insert into qp_social_account (id, user_id, network, account_id, handle, server, credentials, scopes)
     values ($1, $2, 'bluesky', $3, 'ada.bsky.social', 'https://pds.example', $4, '')`,
    [accountId, userId, did, encryptSecret(JSON.stringify({ identifier, appPassword }), settingsKey)],
  );
  const now = new Date();
  const scheduled = await store.schedule(userId, postId, {
    kind: "bluesky", target: accountId, label: "ada.bsky.social", text: "Ships today.",
  }, new Date(now.getTime() - 60_000), now);
  if (scheduled !== true) throw new Error("The test row could not be scheduled.");
});

afterAll(async () => {
  try {
    await pg.close();
  } finally {
    vi.unstubAllEnvs();
  }
});

describe("Bluesky posting through GET /api/cron/due", () => {
  it("refuses a request without the bearer secret before sending anything", async () => {
    expect((await GET(new Request(cronUrl))).status).toBe(401);
    expect(post).not.toHaveBeenCalled();
    expect(await storedRow()).toMatchObject({ status: "scheduled", callStartedAt: null });
  });

  it("sends the exact text with decrypted credentials and the destination's stable record key", async () => {
    const row = await storedRow();
    const rkey = tidFor(`${postId}:${accountId}`, row.createdAt);
    const link = `https://bsky.app/profile/${did}/post/${rkey}`;
    const response = await runCron();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ handled: 1, sent: 1, next: null });
    expect(post).toHaveBeenCalledTimes(2);

    const [sessionUrl, sessionInit] = post.mock.calls[0];
    expect(sessionUrl.toString()).toBe("https://pds.example/xrpc/com.atproto.server.createSession");
    expect(new Headers(sessionInit.headers).get("content-type")).toBe("application/json");
    expect(JSON.parse(sessionInit.body)).toEqual({ identifier, password: appPassword });

    const [recordUrl, recordInit] = post.mock.calls[1];
    expect(recordUrl.toString()).toBe("https://pds.example/xrpc/com.atproto.repo.createRecord");
    const headers = new Headers(recordInit.headers);
    expect(headers.get("authorization")).toBe(`Bearer ${accessJwt}`);
    expect(headers.get("content-type")).toBe("application/json");
    expect(JSON.parse(recordInit.body)).toEqual({
      repo: did, collection: "app.bsky.feed.post", rkey,
      record: { $type: "app.bsky.feed.post", text: "Ships today.", createdAt: expect.any(String) },
    });
    expect(await storedRow()).toMatchObject({ status: "sent", link, error: null, bufferPostId: null });
  });

  it("sends nothing on a second authorized GET after the row was sent", async () => {
    const row = await storedRow();
    const link = `https://bsky.app/profile/${did}/post/${tidFor(`${postId}:${accountId}`, row.createdAt)}`;
    const first = await runCron();
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ handled: 1, sent: 1, next: null });
    const second = await runCron();
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({ handled: 0, sent: 0, next: null });
    expect(post).toHaveBeenCalledTimes(2);
    expect(await storedRow()).toMatchObject({ status: "sent", link, error: null });
  });

  it("marks the account broken and the row failed when createSession answers 401", async () => {
    post.mockResolvedValueOnce(Response.json({ error: "AuthenticationRequired", message: "Invalid app password" }, { status: 401 }));
    const response = await runCron();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ handled: 1, sent: 0, next: null });
    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0][0].toString()).toBe("https://pds.example/xrpc/com.atproto.server.createSession");
    expect(await storedRow()).toMatchObject({ status: "failed", link: null, error: expect.stringContaining("Connect the account again") });
    const { rows } = await pg.query<{ broken: boolean }>(
      `select broken_at is not null as broken from qp_social_account where id = $1 and user_id = $2`,
      [accountId, userId],
    );
    expect(rows).toEqual([{ broken: true }]);
  });

  it("fails a row whose account was deleted without making a network call", async () => {
    await pg.query(`delete from qp_social_account where id = $1 and user_id = $2`, [accountId, userId]);
    const response = await runCron();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ handled: 1, sent: 0, next: null });
    expect(post).not.toHaveBeenCalled();
    expect(await storedRow()).toMatchObject({
      status: "failed", link: null, error: expect.stringContaining("disconnected"), callStartedAt: null,
    });
  });

  it("treats a sign-in that does not answer as nothing sent: the row is not uncertain and no post was made", async () => {
    post.mockImplementation(async (url) => {
      if (url.toString().endsWith("com.atproto.server.createSession")) return new Response("Service Unavailable", { status: 503 });
      throw new Error(`Unexpected POST: ${url}`);
    });
    const res = await runCron();
    expect(res.status).toBe(200);
    expect(post.mock.calls.map(([u]) => u.toString())).toEqual(["https://pds.example/xrpc/com.atproto.server.createSession"]);
    // Claimed but never started: the next run after the claim runs out takes it again. Never "uncertain".
    expect(await storedRow()).toMatchObject({ status: "pending", callStartedAt: null });
  });

  it("reuses the kept session for the next post: one sign-in for two posts", async () => {
    expect((await runCron()).status).toBe(200);
    const now = new Date();
    expect(await store.schedule(userId, "bluesky-e2e-post-2", { kind: "bluesky", target: accountId, label: "ada.bsky.social", text: "And again." }, new Date(now.getTime() - 60_000), now)).toBe(true);
    expect((await runCron()).status).toBe(200);
    const urls = post.mock.calls.map(([u]) => u.toString());
    expect(urls.filter((u) => u.endsWith("createSession"))).toHaveLength(1);
    expect(urls.filter((u) => u.endsWith("createRecord"))).toHaveLength(2);
    expect((await store.rows(userId, "bluesky-e2e-post-2"))[0]).toMatchObject({ status: "sent" });
  });

  it("refreshes an expired session and posts once, never marking the row uncertain", async () => {
    let first = true;
    post.mockImplementation(async (url, init) => {
      const u = url.toString();
      if (u.endsWith("createSession")) return Response.json({ did, accessJwt: "old", refreshJwt: "ref-1" });
      if (u.endsWith("refreshSession")) return Response.json({ did, accessJwt: "new", refreshJwt: "ref-2" });
      if (u.endsWith("createRecord")) {
        if (first && init.headers?.authorization === "Bearer old") { first = false; return Response.json({ error: "ExpiredToken", message: "Token has expired" }, { status: 400 }); }
        const { rkey } = JSON.parse(init.body);
        return Response.json({ uri: `at://${did}/app.bsky.feed.post/${rkey}`, cid: "bafy" });
      }
      throw new Error(`Unexpected POST: ${u}`);
    });
    expect((await runCron()).status).toBe(200);
    const urls = post.mock.calls.map(([u]) => u.toString().split("/").pop());
    expect(urls).toEqual(["com.atproto.server.createSession", "com.atproto.repo.createRecord", "com.atproto.server.refreshSession", "com.atproto.repo.createRecord"]);
    expect(await storedRow()).toMatchObject({ status: "sent" });
  });

  it("marks the row failed, not uncertain, when the session cannot be renewed (nothing was posted)", async () => {
    post.mockImplementation(async (url) => {
      const u = url.toString();
      if (u.endsWith("createSession") && post.mock.calls.length === 1) return Response.json({ did, accessJwt: "old", refreshJwt: "ref-1" });
      if (u.endsWith("createRecord")) return Response.json({ error: "ExpiredToken", message: "Token has expired" }, { status: 400 });
      return new Response("Service Unavailable", { status: 503 });
    });
    expect((await runCron()).status).toBe(200);
    expect(await storedRow()).toMatchObject({ status: "failed" });
  });

  it("leaves a createRecord 500 uncertain and never sends that row again on the next GET", async () => {
    post.mockResolvedValueOnce(Response.json({ did, accessJwt }));
    post.mockResolvedValueOnce(Response.json({ error: "InternalServerError" }, { status: 500 }));
    const first = await runCron();
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ handled: 1, sent: 0, next: null });
    expect(await storedRow()).toMatchObject({ status: "uncertain", link: null });
    expect(post).toHaveBeenCalledTimes(2);
    expect(post.mock.calls[1][0].toString()).toBe("https://pds.example/xrpc/com.atproto.repo.createRecord");
    const second = await runCron();
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({ handled: 0, sent: 0, next: null });
    expect(post).toHaveBeenCalledTimes(2);
    expect(await storedRow()).toMatchObject({ status: "uncertain", link: null });
  });

  it("puts a scheduled row back to wait without a failure when createRecord answers 429", async () => {
    post.mockResolvedValueOnce(Response.json({ did, accessJwt }));
    post.mockResolvedValueOnce(Response.json({ error: "RateLimitExceeded" }, { status: 429, headers: { "Retry-After": "120" } }));
    const row = await storedRow();
    const before = Date.now();
    const response = await runCron();
    const after = Date.now();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ handled: 1, sent: 0, next: expect.any(String) });
    expect(post).toHaveBeenCalledTimes(2);
    expect(post.mock.calls[1][0].toString()).toBe("https://pds.example/xrpc/com.atproto.repo.createRecord");
    const waiting = await storedRow();
    expect(waiting).toMatchObject({ status: "scheduled", link: null, error: null, callStartedAt: null, sendAt: row.sendAt });
    expect(waiting.claimedUntil!.getTime()).toBeGreaterThanOrEqual(before + 120_000);
    // The wait Bluesky asked for, plus up to a tenth more (jitter).
    expect(waiting.claimedUntil!.getTime()).toBeLessThanOrEqual(after + 132_000);
    const second = await runCron();
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({ handled: 0, sent: 0, next: null });
    expect(post).toHaveBeenCalledTimes(2);
    expect(await storedRow()).toMatchObject({ status: "scheduled", error: null });
  });
});
