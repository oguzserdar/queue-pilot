/**
 * @fileoverview Reusing a Bluesky session: the first call signs in and saves the session encrypted; later calls reuse
 * it without signing in; an expired access token is refreshed and the call made once more; a refused refresh falls
 * back to signing in; another failure is never retried.
 */
import { migratedPglite } from "@/test/migrated-pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { encryptSecret } from "./secrets";
import type { Post } from "./bluesky";

vi.mock("server-only", () => ({}));
const master = "3c".repeat(32);
vi.stubEnv("DATABASE_URL", "postgres://test@localhost/unused");
vi.stubEnv("SETTINGS_KEY", master);
const pg = await migratedPglite();
const testDb = drizzle(pg, { schema: await import("@/db/schema") });
vi.mock("@/db", () => ({ db: () => testDb }));
const { withBlueskySession } = await import("./bluesky-session");
const { readSocialAccount } = await import("./social-accounts");
const { BlueskyError } = await import("./bluesky");

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
let signIns = 0;
let refreshes = 0;
const post = vi.fn<Post>(async (url, init) => {
  const u = url.toString();
  if (u.endsWith("createSession")) { signIns++; return json(200, { did: "did:plc:a", accessJwt: `acc-s${signIns}`, refreshJwt: `ref-s${signIns}`, handle: "ada.bsky.social" }); }
  if (u.endsWith("refreshSession")) { refreshes++; return init.headers.authorization === "Bearer ref-bad" ? json(400, { error: "ExpiredToken", message: "Token has expired" }) : json(200, { did: "did:plc:a", accessJwt: `acc-r${refreshes}`, refreshJwt: `ref-r${refreshes}`, handle: "ada.bsky.social" }); }
  throw new Error(`unexpected ${u}`);
});
const account = () => readSocialAccount("u1", "acc-1").then((a) => a!);
const stored = async () => (await pg.query<{ session: string | null }>(`select session from qp_social_account where id = 'acc-1'`)).rows[0].session;
const expired = () => new BlueskyError("expired", 400, undefined, "Token has expired", "ExpiredToken");

beforeEach(async () => {
  signIns = 0; refreshes = 0; post.mockClear();
  await pg.query(`delete from qp_social_account`);
  await pg.query(`insert into "user" (id, name, email) values ('u1', 'Ada', 'ada@s.example') on conflict do nothing`);
  await pg.query(`insert into qp_social_account (id, user_id, network, account_id, handle, server, credentials) values ('acc-1', 'u1', 'bluesky', 'did:plc:a', 'ada.bsky.social', 'https://pds.example', $1)`, [encryptSecret(JSON.stringify({ identifier: "ada.bsky.social", appPassword: "app-pw" }), master)]);
});
afterAll(async () => { await pg.close(); });

describe("withBlueskySession", () => {
  it("signs in once, saves the session encrypted, and reuses it on the next call", async () => {
    const seen: string[] = [];
    await withBlueskySession("u1", await account(), async (s) => { seen.push(s.accessJwt); }, { post });
    await withBlueskySession("u1", await account(), async (s) => { seen.push(s.accessJwt); }, { post });
    expect(signIns).toBe(1);
    expect(seen).toEqual(["acc-s1", "acc-s1"]);
    const raw = await stored();
    expect(raw).toBeTruthy();
    expect(raw).not.toContain("acc-s1");
    expect(raw).not.toContain("ref-s1");
  });

  it("refreshes an expired token and makes the call once more, without signing in again", async () => {
    await withBlueskySession("u1", await account(), async () => {}, { post });
    let calls = 0;
    const r = await withBlueskySession("u1", await account(), async (s) => { calls++; if (s.accessJwt === "acc-s1") throw expired(); return s.accessJwt; }, { post });
    expect(r).toBe("acc-r1");
    expect(calls).toBe(2);
    expect(signIns).toBe(1);
    expect(refreshes).toBe(1);
  });

  it("signs in again when the refresh token is refused too", async () => {
    await pg.query(`update qp_social_account set session = $1 where id = 'acc-1'`, [encryptSecret(JSON.stringify({ did: "did:plc:a", accessJwt: "acc-old", refreshJwt: "ref-bad" }), master)]);
    const r = await withBlueskySession("u1", await account(), async (s) => { if (s.accessJwt === "acc-old") throw expired(); return s.accessJwt; }, { post });
    expect(r).toBe("acc-s1");
    expect(signIns).toBe(1);
  });

  it("never retries a failure that is not an expired token", async () => {
    let calls = 0;
    await expect(withBlueskySession("u1", await account(), async () => { calls++; throw new BlueskyError("too long", 400, undefined, "Text too long", "InvalidRequest"); }, { post })).rejects.toThrow("too long");
    expect(calls).toBe(1);
  });
});
