/**
 * @fileoverview Connecting and disconnecting a person's own Mastodon and Bluesky accounts, on the migrated database:
 * - the instance or server address guard (https only; never localhost, a private address or a name without a dot)
 * - Queue Pilot's app on a Mastodon instance is registered once per instance and callback, and its secret is encrypted
 * - the sign-in's state is bound to the person and expires; a mismatch is refused before any token exchange
 * - the callback stores the account with encrypted credentials, and a reconnect updates it and clears "broken"
 * - Bluesky refuses a wrong app password with the server's reason, and a main password outright
 * - one person can never disconnect or switch replies on another person's account
 * - disconnect deletes the row, its read position and its waiting posts, and revokes the Mastodon token
 */
import { BlockedAddressError } from "@/lib/safe-fetch";
import { decryptSecret, encryptSecret } from "@/lib/secrets";
import { migratedPglite } from "@/test/migrated-pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const master = "34".repeat(32);
vi.stubEnv("DATABASE_URL", "postgres://test@localhost/unused");
vi.stubEnv("SETTINGS_KEY", master);

const pg = await migratedPglite();
const testDb = drizzle(pg, { schema: { ...(await import("@/db/schema")), ...(await import("@/db/auth-schema")) } });
vi.mock("@/db", () => ({ db: () => testDb }));

const { ConnectError, MASTODON_SCOPES, connectBluesky, disconnectSocialAccount, finishMastodonConnect, mastodonApp, normalizeServer, startMastodonConnect } = await import("./social-connect");
const { setReplies, listSocialAccounts } = await import("./social-accounts");

type Post = (url: URL, init: { headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<Response>;
type Get = (url: URL, init: { headers: Record<string, string>; signal?: AbortSignal }) => Promise<Response>;

const redirectUri = "https://app.example/api/mastodon/callback";
const ada = "connect-ada";
const bob = "connect-bob";
const at = new Date("2026-11-15T10:00:00.000Z");

/** A fake Mastodon instance at https://m.example: apps, token, verify_credentials and revoke. */
function mastodon(opts: { token?: string; accountId?: string; tokenStatus?: number; tokenError?: string } = {}) {
  let apps = 0;
  const post = vi.fn<Post>(async (url) => {
    if (url.pathname === "/api/v1/apps") {
      apps++;
      return Response.json({ id: `app-${apps}`, client_id: `client-${apps}`, client_secret: `secret-${apps}`, scopes: MASTODON_SCOPES.split(" ") });
    }
    if (url.pathname === "/oauth/token") {
      if (opts.tokenStatus) return Response.json({ error: opts.tokenError ?? "invalid_grant" }, { status: opts.tokenStatus });
      return Response.json({ access_token: opts.token ?? "token-ada-1", token_type: "Bearer", scope: MASTODON_SCOPES, created_at: 1 });
    }
    if (url.pathname === "/oauth/revoke") return Response.json({});
    return new Response("not found", { status: 404 });
  });
  const get = vi.fn<Get>(async (url) => {
    if (url.pathname === "/api/v1/accounts/verify_credentials") return Response.json({ id: opts.accountId ?? "109", acct: "ada", username: "ada", url: "https://m.example/@ada" });
    return new Response("not found", { status: 404 });
  });
  return { post, get, deps: { master, post, get, now: () => at } };
}

/** Runs the full Mastodon round trip and returns the stored row. */
async function connectMastodon(userId: string, m: ReturnType<typeof mastodon>, instance = "m.example") {
  const { url, cookie } = await startMastodonConnect(userId, instance, redirectUri, m.deps);
  const state = new URL(url).searchParams.get("state")!;
  await finishMastodonConnect({ userId, cookie, state, code: "code-1", redirectUri }, m.deps);
  return (await pg.query<Record<string, unknown>>(`select * from qp_social_account where user_id = $1 and network = 'mastodon'`, [userId])).rows;
}

/** A fake Bluesky server: createSession answers with the given access token scope, DID document and status. */
function bluesky(opts: { status?: number; message?: string; scope?: string | null; pds?: string } = {}) {
  const claims = opts.scope === null ? {} : { scope: opts.scope ?? "com.atproto.appPass" };
  const jwt = `e30.${Buffer.from(JSON.stringify({ sub: "did:plc:ada", ...claims })).toString("base64url")}.sig`;
  const post = vi.fn<Post>(async (url) => {
    if (url.pathname !== "/xrpc/com.atproto.server.createSession") return new Response("not found", { status: 404 });
    if (opts.status) return Response.json({ error: "AuthenticationRequired", message: opts.message ?? "Invalid identifier or password" }, { status: opts.status });
    return Response.json({
      did: "did:plc:ada", handle: "ada.bsky.social", accessJwt: jwt, refreshJwt: "refresh",
      didDoc: { id: "did:plc:ada", service: [{ id: "#atproto_pds", type: "AtprotoPersonalDataServer", serviceEndpoint: opts.pds ?? "https://pds.example" }] },
    });
  });
  return { post, deps: { master, post, now: () => at } };
}

beforeEach(async () => {
  await pg.query(`delete from qp_announcement_send`);
  await pg.query(`delete from qp_social_account`);
  await pg.query(`delete from qp_mastodon_app`);
  await pg.query(`delete from "user" where id in ($1, $2)`, [ada, bob]);
  await pg.query(`insert into "user" (id, name, email) values ($1, 'Ada', 'ada@connect.example'), ($2, 'Bob', 'bob@connect.example')`, [ada, bob]);
});

afterAll(async () => {
  try {
    await pg.close();
  } finally {
    vi.unstubAllEnvs();
  }
});

describe("the instance address guard", () => {
  it.each(["http://m.example", "localhost", "https://localhost:3000", "127.0.0.1", "https://[::1]", "10.0.0.5", "169.254.169.254", "intranet", "https://user:pw@m.example"])("refuses %s before anything is sent", async (address) => {
    const m = mastodon();
    expect(() => normalizeServer(address)).toThrow(ConnectError);
    await expect(startMastodonConnect(ada, address, redirectUri, m.deps)).rejects.toBeInstanceOf(ConnectError);
    expect(m.post).not.toHaveBeenCalled();
  });

  it.each([["mastodon.social", "https://mastodon.social"], ["https://Mastodon.Social/", "https://mastodon.social"], ["@ada@m.example", "https://m.example"], ["ada@m.example", "https://m.example"], ["https://m.example:8443/about", "https://m.example:8443"]])("reads %s as %s", (address, origin) => {
    expect(normalizeServer(address)).toBe(origin);
  });

  it("registers through the real guarded fetch, which refuses a private address without touching the network", async () => {
    await expect(mastodonApp("https://127.0.0.1", redirectUri, { master })).rejects.toBeInstanceOf(BlockedAddressError);
  });
});

describe("Queue Pilot's app on a Mastodon instance", () => {
  it("is registered once per instance and callback, then reused", async () => {
    const m = mastodon();
    await startMastodonConnect(ada, "m.example", redirectUri, m.deps);
    await startMastodonConnect(bob, "https://m.example/", redirectUri, m.deps);
    const registrations = m.post.mock.calls.filter(([u]) => u.pathname === "/api/v1/apps");
    expect(registrations).toHaveLength(1);
    const body = new URLSearchParams(registrations[0][1].body);
    expect(body.get("redirect_uris")).toBe(redirectUri);
    expect(body.get("scopes")).toBe("read:accounts read:notifications write:statuses");

    await startMastodonConnect(ada, "m.example", "https://other.example/api/mastodon/callback", m.deps);
    await startMastodonConnect(ada, "n.example", redirectUri, m.deps);
    expect(m.post.mock.calls.filter(([u]) => u.pathname === "/api/v1/apps")).toHaveLength(3);
  });

  it("keeps the app secret encrypted", async () => {
    await startMastodonConnect(ada, "m.example", redirectUri, mastodon().deps);
    const [row] = (await pg.query<{ client_id: string; client_secret: string }>(`select client_id, client_secret from qp_mastodon_app`)).rows;
    expect(row.client_id).toBe("client-1");
    expect(row.client_secret).not.toContain("secret-1");
    expect(row.client_secret.startsWith("v1:")).toBe(true);
    expect(decryptSecret(row.client_secret, master)).toBe("secret-1");
  });

  it("sends the person to the instance's own authorize page with the app, the callback, the scopes and a state", async () => {
    const { url } = await startMastodonConnect(ada, "m.example", redirectUri, mastodon().deps);
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe("https://m.example/oauth/authorize");
    expect(Object.fromEntries(u.searchParams)).toMatchObject({ response_type: "code", client_id: "client-1", redirect_uri: redirectUri, scope: MASTODON_SCOPES });
    expect(u.searchParams.get("state")!.length).toBeGreaterThanOrEqual(20);
  });
});

describe("the Mastodon callback", () => {
  it("refuses a state that does not match, before exchanging the code", async () => {
    const m = mastodon();
    const { cookie } = await startMastodonConnect(ada, "m.example", redirectUri, m.deps);
    await expect(finishMastodonConnect({ userId: ada, cookie, state: "someone-elses-state-value", code: "c", redirectUri }, m.deps)).rejects.toMatchObject({ code: "expired" });
    expect(m.post.mock.calls.some(([u]) => u.pathname === "/oauth/token")).toBe(false);
    expect(await listSocialAccounts(ada)).toEqual([]);
  });

  it("refuses another person's sign-in, an expired one and a changed cookie", async () => {
    const m = mastodon();
    const { url, cookie } = await startMastodonConnect(ada, "m.example", redirectUri, m.deps);
    const state = new URL(url).searchParams.get("state")!;
    await expect(finishMastodonConnect({ userId: bob, cookie, state, code: "c", redirectUri }, m.deps)).rejects.toMatchObject({ code: "expired" });
    const later = { ...m.deps, now: () => new Date(at.getTime() + 11 * 60_000) };
    await expect(finishMastodonConnect({ userId: ada, cookie, state, code: "c", redirectUri }, later)).rejects.toMatchObject({ code: "expired" });
    await expect(finishMastodonConnect({ userId: ada, cookie: cookie.slice(0, -4) + "AAAA", state, code: "c", redirectUri }, m.deps)).rejects.toMatchObject({ code: "expired" });
    await expect(finishMastodonConnect({ userId: ada, cookie: undefined, state, code: "c", redirectUri }, m.deps)).rejects.toMatchObject({ code: "expired" });
    expect(m.post.mock.calls.some(([u]) => u.pathname === "/oauth/token")).toBe(false);
  });

  it("exchanges the code and stores the account with the token encrypted, never in plain text", async () => {
    const m = mastodon({ token: "token-ada-plain" });
    const rows = await connectMastodon(ada, m);
    const exchange = m.post.mock.calls.find(([u]) => u.pathname === "/oauth/token")!;
    expect(Object.fromEntries(new URLSearchParams(exchange[1].body))).toEqual({ grant_type: "authorization_code", code: "code-1", client_id: "client-1", client_secret: "secret-1", redirect_uri: redirectUri });
    expect(m.get.mock.calls[0][1].headers.authorization).toBe("Bearer token-ada-plain");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ account_id: "109", handle: "@ada@m.example", server: "https://m.example", scopes: MASTODON_SCOPES, broken_at: null, replies_on: false });
    expect(JSON.stringify(rows[0])).not.toContain("token-ada-plain");
    expect(JSON.parse(decryptSecret(rows[0].credentials as string, master))).toMatchObject({ token: "token-ada-plain" });
  });

  it("updates the same row on a reconnect and clears broken", async () => {
    const [first] = await connectMastodon(ada, mastodon({ token: "token-old" }));
    await pg.query(`update qp_social_account set broken_at = now() where id = $1`, [first.id]);
    const [again] = await connectMastodon(ada, mastodon({ token: "token-new" }));
    expect(again.id).toBe(first.id);
    expect(again.broken_at).toBeNull();
    expect(JSON.parse(decryptSecret(again.credentials as string, master)).token).toBe("token-new");
  });

  it("forgets an app the instance no longer accepts, so the next connect registers again", async () => {
    const m = mastodon({ tokenStatus: 401, tokenError: "invalid_client" });
    const { url, cookie } = await startMastodonConnect(ada, "m.example", redirectUri, m.deps);
    await expect(finishMastodonConnect({ userId: ada, cookie, state: new URL(url).searchParams.get("state")!, code: "c", redirectUri }, m.deps)).rejects.toBeInstanceOf(ConnectError);
    expect((await pg.query(`select 1 from qp_mastodon_app`)).rows).toHaveLength(0);
  });
});

describe("connecting Bluesky with an app password", () => {
  it("refuses a wrong app password with the server's reason and stores nothing", async () => {
    const b = bluesky({ status: 401, message: "Invalid identifier or password" });
    const error = await connectBluesky(ada, { handle: "@ada.bsky.social", appPassword: "wrong-wrong-wrong-wrong" }, b.deps).catch((e) => e);
    expect(error).toBeInstanceOf(ConnectError);
    expect(error.message).toContain("Invalid identifier or password");
    expect(error.message).toMatch(/app password/i);
    expect(await listSocialAccounts(ada)).toEqual([]);
  });

  it("refuses a main account password and stores nothing", async () => {
    const b = bluesky({ scope: "com.atproto.access" });
    await expect(connectBluesky(ada, { handle: "ada.bsky.social", appPassword: "main-password" }, b.deps)).rejects.toMatchObject({ code: "main-password" });
    expect(await listSocialAccounts(ada)).toEqual([]);
  });

  it("signs in at bsky.social by default and stores the DID, handle, the account's own server and encrypted credentials", async () => {
    const b = bluesky();
    await connectBluesky(ada, { handle: "@Ada.bsky.social", appPassword: "abcd-efgh-ijkl-mnop" }, b.deps);
    expect(b.post.mock.calls[0][0].toString()).toBe("https://bsky.social/xrpc/com.atproto.server.createSession");
    expect(JSON.parse(b.post.mock.calls[0][1].body)).toEqual({ identifier: "ada.bsky.social", password: "abcd-efgh-ijkl-mnop" });
    const [row] = (await pg.query<Record<string, string>>(`select * from qp_social_account where user_id = $1`, [ada])).rows;
    expect(row).toMatchObject({ network: "bluesky", account_id: "did:plc:ada", handle: "ada.bsky.social", server: "https://pds.example" });
    expect(JSON.stringify(row)).not.toContain("abcd-efgh-ijkl-mnop");
    expect(JSON.parse(decryptSecret(row.credentials, master))).toEqual({ identifier: "did:plc:ada", appPassword: "abcd-efgh-ijkl-mnop" });
  });

  it("accepts a token without a known scope, and keeps the server it signed in to when the DID document names no https server", async () => {
    await connectBluesky(ada, { handle: "ada.example.com", appPassword: "pw", server: "pds.example" }, bluesky({ scope: null, pds: "http://10.0.0.1" }).deps);
    const [row] = (await pg.query<Record<string, string>>(`select server from qp_social_account where user_id = $1`, [ada])).rows;
    expect(row.server).toBe("https://pds.example");
  });

  it("refuses a private server address before sending the password", async () => {
    const b = bluesky();
    await expect(connectBluesky(ada, { handle: "ada.example.com", appPassword: "pw", server: "http://192.168.1.2" }, b.deps)).rejects.toBeInstanceOf(ConnectError);
    expect(b.post).not.toHaveBeenCalled();
  });
});

describe("one person's accounts are theirs alone", () => {
  it("never switches replies on another person's account", async () => {
    const [row] = await connectMastodon(ada, mastodon());
    expect(await setReplies(bob, row.id as string, true)).toBe("not-found");
    expect((await listSocialAccounts(ada))[0].repliesOn).toBe(false);
  });

  it("never disconnects another person's account, and never revokes its token", async () => {
    const m = mastodon();
    const [row] = await connectMastodon(ada, m);
    m.post.mockClear();
    expect(await disconnectSocialAccount(bob, row.id as string, m.deps)).toBe(false);
    expect(await listSocialAccounts(ada)).toHaveLength(1);
    expect(m.post).not.toHaveBeenCalled();
  });

  it("flips replies on only the account named", async () => {
    const [mRow] = await connectMastodon(ada, mastodon());
    await connectBluesky(ada, { handle: "ada.bsky.social", appPassword: "pw" }, bluesky().deps);
    expect(await setReplies(ada, mRow.id as string, true)).toBe("ok");
    const accounts = await listSocialAccounts(ada);
    expect(accounts.map((a) => [a.network, a.repliesOn]).sort(([a], [b]) => String(a).localeCompare(String(b)))).toEqual([["bluesky", false], ["mastodon", true]]);
  });
});

describe("disconnecting", () => {
  it("deletes the account, its read position and its waiting posts, and revokes the Mastodon token", async () => {
    const m = mastodon({ token: "token-to-revoke" });
    const [row] = await connectMastodon(ada, m);
    const id = row.id as string;
    await pg.query(`insert into qp_reply_cursor (account_id, user_id, polled_at) values ($1, $2, now())`, [id, ada]);
    await pg.query(
      `insert into qp_announcement_send (announcement_id, user_id, kind, target, label, text, status, send_at, created_at, updated_at)
       values ('p-wait', $1, 'mastodon', $2, '@ada@m.example', 'Soon.', 'scheduled', now() + interval '1 day', now(), now())`,
      [ada, id],
    );
    expect(await disconnectSocialAccount(ada, id, m.deps)).toBe(true);
    expect(await listSocialAccounts(ada)).toEqual([]);
    expect((await pg.query(`select 1 from qp_reply_cursor where account_id = $1`, [id])).rows).toHaveLength(0);
    expect((await pg.query<{ status: string }>(`select status from qp_announcement_send where announcement_id = 'p-wait'`)).rows[0].status).toBe("cancelled");
    const revoke = m.post.mock.calls.find(([u]) => u.pathname === "/oauth/revoke")!;
    expect(Object.fromEntries(new URLSearchParams(revoke[1].body))).toEqual({ client_id: "client-1", client_secret: "secret-1", token: "token-to-revoke" });
  });

  it("still disconnects when the instance cannot be reached to revoke", async () => {
    const m = mastodon();
    const [row] = await connectMastodon(ada, m);
    m.post.mockImplementation(async () => { throw new Error("network down"); });
    expect(await disconnectSocialAccount(ada, row.id as string, m.deps)).toBe(true);
    expect(await listSocialAccounts(ada)).toEqual([]);
  });

  it("disconnects an account whose credentials can no longer be read", async () => {
    await pg.query(
      `insert into qp_social_account (id, user_id, network, account_id, handle, server, credentials) values ('broken-creds', $1, 'mastodon', '1', '@x@m.example', 'https://m.example', $2)`,
      [ada, encryptSecret("{}", "56".repeat(32))],
    );
    expect(await disconnectSocialAccount(ada, "broken-creds", mastodon().deps)).toBe(true);
    expect(await listSocialAccounts(ada)).toEqual([]);
  });
});
