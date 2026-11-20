import { createHash } from "node:crypto";
/**
 * @fileoverview Mastodon posts through the real cron route, migrated Postgres store, sender registry, client and
 * account reader. Only the Mastodon network edge and the unused Buffer auth setup are faked.
 */
import { encryptSecret } from "@/lib/secrets";
import { migratedPglite } from "@/test/migrated-pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const settingsKey = "12".repeat(32);
const cronSecret = "test-mastodon-cron-secret";
vi.stubEnv("DATABASE_URL", "postgres://test@localhost/unused");
vi.stubEnv("SETTINGS_KEY", settingsKey);
vi.stubEnv("CRON_SECRET", cronSecret);

const pg = await migratedPglite();
const testDb = drizzle(pg, { schema: { ...(await import("@/db/schema")), ...(await import("@/db/auth-schema")) } });
vi.mock("@/db", () => ({ db: () => testDb }));
// These posts have no bufferPostId, so the real registry never needs Buffer sign-in or a Buffer read.
vi.mock("@/lib/auth", () => ({ getAuth: async () => null, BUFFER_PROVIDER_ID: "buffer" }));
vi.mock("@/lib/safe-fetch", async (original) => {
  const actual = await original<typeof import("@/lib/safe-fetch")>();
  return { ...actual, safePost: vi.fn<typeof actual.safePost>() };
});

const { GET } = await import("./route");
const { postgresDirectPostStore } = await import("@/lib/direct-post-store");
const { safePost } = await import("@/lib/safe-fetch");
const post = vi.mocked(safePost);
const store = postgresDirectPostStore();

const userId = "mastodon-e2e-user";
const accountId = "mastodon-e2e-account";
const postId = "mastodon-e2e-post";
const token = "test-mastodon-access-token";
const link = "https://m.example/@ada/1101";
const cronUrl = "https://app.example/api/cron/due";
const runCron = () => GET(new Request(cronUrl, { headers: { authorization: `Bearer ${cronSecret}` } }));
const storedRow = async () => (await store.rows(userId, postId))[0];

beforeAll(async () => {
  await pg.query(`insert into "user" (id, name, email) values ($1, 'Ada', 'ada@mastodon-e2e.example')`, [userId]);
});

beforeEach(async () => {
  post.mockReset();
  post.mockImplementation(async () => Response.json({ id: "1101", url: link }));
  await pg.query(`delete from qp_announcement_send where user_id = $1`, [userId]);
  await pg.query(`delete from qp_social_account where user_id = $1`, [userId]);
  await pg.query(
    `insert into qp_social_account (id, user_id, network, account_id, handle, server, credentials, scopes)
     values ($1, $2, 'mastodon', 'network-account-ada', '@ada@m.example', 'https://m.example', $3, 'write:statuses')`,
    [accountId, userId, encryptSecret(JSON.stringify({ token }), settingsKey)],
  );
  const now = new Date();
  const scheduled = await store.schedule(userId, postId, {
    kind: "mastodon", target: accountId, label: "@ada@m.example", text: "Ships today.",
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

describe("Mastodon posting through GET /api/cron/due", () => {
  it("refuses a request without the bearer secret before sending anything", async () => {
    expect((await GET(new Request(cronUrl))).status).toBe(401);
    expect(post).not.toHaveBeenCalled();
    expect(await storedRow()).toMatchObject({ status: "scheduled", callStartedAt: null });
  });

  it("sends the exact status with decrypted credentials and the destination's idempotency key", async () => {
    const response = await runCron();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ handled: 1, sent: 1, next: null });
    expect(post).toHaveBeenCalledTimes(1);
    const [url, init] = post.mock.calls[0];
    expect(url.toString()).toBe("https://m.example/api/v1/statuses");
    const headers = new Headers(init.headers);
    expect(headers.get("authorization")).toBe(`Bearer ${token}`);
    expect(headers.get("idempotency-key")).toBe(`${postId}:${accountId}:${createHash("sha256").update("Ships today.").digest("hex").slice(0, 16)}`);
    expect(headers.get("content-type")).toBe("application/json");
    expect(JSON.parse(init.body)).toEqual({ status: "Ships today.", visibility: "public" });
    expect(await storedRow()).toMatchObject({ status: "sent", link, error: null, bufferPostId: null });
  });

  it("sends nothing on a second authorized GET after the row was sent", async () => {
    const first = await runCron();
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ handled: 1, sent: 1, next: null });
    const second = await runCron();
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({ handled: 0, sent: 0, next: null });
    expect(post).toHaveBeenCalledTimes(1);
    expect(await storedRow()).toMatchObject({ status: "sent", link, error: null });
  });

  it("marks the account broken and the row failed when Mastodon answers 401", async () => {
    post.mockResolvedValueOnce(Response.json({ error: "The access token is invalid" }, { status: 401 }));
    const response = await runCron();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ handled: 1, sent: 0, next: null });
    expect(post).toHaveBeenCalledTimes(1);
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

  it("leaves a 502 uncertain and never sends that row again on the next GET", async () => {
    post.mockResolvedValueOnce(new Response("Bad Gateway", { status: 502 }));
    const first = await runCron();
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ handled: 1, sent: 0, next: null });
    expect(await storedRow()).toMatchObject({ status: "uncertain", link: null });
    expect(post).toHaveBeenCalledTimes(1);
    const second = await runCron();
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({ handled: 0, sent: 0, next: null });
    expect(post).toHaveBeenCalledTimes(1);
    expect(await storedRow()).toMatchObject({ status: "uncertain", link: null });
  });
});
