/**
 * @fileoverview Bluesky with a fake PDS: the exact sign-in and createRecord requests (paths, token, body), the link
 * back, a refusal, a bad password, a rate limit with its wait, an answer that may or may not have landed, the record
 * key derived from a stable key, reading mentions (the exact request, the cursor, the root of a reply, refusals, and
 * no redirect followed with the token) and the reply record with its root and parent.
 */
import { describe, expect, it, vi } from "vitest";
import { BlueskyError, createSession, isExpiredToken, listMentions, postText, refreshSession, replyTo, tidFor, type Get, type Post } from "./bluesky";

vi.mock("server-only", () => ({}));
const safeGetSpy = vi.hoisted(() => vi.fn<typeof import("./safe-fetch").safeGet>());
vi.mock("./safe-fetch", async (importOriginal) => ({ ...(await importOriginal<object>()), safeGet: safeGetSpy }));

const answer = (status: number, body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const session = { did: "did:plc:ada123", accessJwt: "jwt-1" };
const at = () => new Date("2026-11-14T12:00:00.000Z");

// The TID syntax regex from bluesky-social/atproto packages/syntax/src/tid.ts at 7dd086d4de20d22777a64043ee29f4afa9a5811b.
const TID_REGEX = /^[234567abcdefghij][234567abcdefghijklmnopqrstuvwxyz]{12}$/;

describe("createSession", () => {
  it("sends the identifier and app password to createSession and returns the DID and access token", async () => {
    const post = vi.fn<Post>(async () => answer(200, { did: "did:plc:ada123", accessJwt: "jwt-1", refreshJwt: "r", handle: "ada.bsky.social" }));
    const s = await createSession("https://pds.example", "ada.bsky.social", "app-pass", post);
    expect(s).toEqual({ did: "did:plc:ada123", accessJwt: "jwt-1", refreshJwt: "r" });
    const [url, init] = post.mock.calls[0];
    expect(url.toString()).toBe("https://pds.example/xrpc/com.atproto.server.createSession");
    expect(init.headers.authorization).toBeUndefined();
    expect(JSON.parse(init.body)).toEqual({ identifier: "ada.bsky.social", password: "app-pass" });
  });

  it("turns a bad password into a refusal that says to connect again", async () => {
    const e = await createSession("https://pds.example", "ada", "wrong", async () => answer(401, { error: "AuthenticationRequired", message: "Invalid identifier or password" })).catch((x) => x);
    expect(e).toBeInstanceOf(BlueskyError);
    expect(e).toMatchObject({ status: 401 });
    expect(e.message).toContain("Invalid identifier or password");
    expect(e.message).toContain("Connect the account again");
  });

  it("treats an answer without a session as not known", async () => {
    const e = await createSession("https://pds.example", "ada", "p", async () => answer(200, { did: "did:plc:x" })).catch((x) => x);
    expect(e).toBeInstanceOf(Error);
    expect(e).not.toBeInstanceOf(BlueskyError);
  });
});

describe("postText", () => {
  it("writes one app.bsky.feed.post record under the given key with the token, and returns the link", async () => {
    const post = vi.fn<Post>(async () => answer(200, { uri: "at://did:plc:ada123/app.bsky.feed.post/3abcdefghijkl", cid: "bafy" }));
    const r = await postText("https://pds.example", session, "Ships today.", "3abcdefghijkl", post, at);
    expect(r).toEqual({ uri: "at://did:plc:ada123/app.bsky.feed.post/3abcdefghijkl", link: "https://bsky.app/profile/did:plc:ada123/post/3abcdefghijkl" });
    const [url, init] = post.mock.calls[0];
    expect(url.toString()).toBe("https://pds.example/xrpc/com.atproto.repo.createRecord");
    expect(init.headers).toMatchObject({ authorization: "Bearer jwt-1", "content-type": "application/json" });
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(init.body)).toEqual({
      repo: "did:plc:ada123",
      collection: "app.bsky.feed.post",
      rkey: "3abcdefghijkl",
      record: { $type: "app.bsky.feed.post", text: "Ships today.", createdAt: "2026-11-14T12:00:00.000Z" },
    });
  });

  it("turns a 4xx into a refusal with Bluesky's own words", async () => {
    const e = await postText("https://pds.example", session, "x", "3abcdefghijkl", async () => answer(400, { error: "InvalidRequest", message: "Invalid app.bsky.feed.post record: text too long" })).catch((x) => x);
    expect(e).toBeInstanceOf(BlueskyError);
    expect(e).toMatchObject({ status: 400 });
    expect(e.message).toContain("text too long");
  });

  it("asks to connect again when the token is refused", async () => {
    const e = await postText("https://pds.example", session, "x", "3abcdefghijkl", async () => answer(401, { error: "ExpiredToken", message: "Token has expired" })).catch((x) => x);
    expect(e).toBeInstanceOf(BlueskyError);
    expect(e.message).toContain("Connect the account again");
  });

  it("reads the wait from Retry-After, then RateLimit-Reset, else 60 s", async () => {
    const e1 = await postText("https://p.example", session, "x", "k", async () => answer(429, { error: "RateLimitExceeded" }, { "retry-after": "120" }), at).catch((x) => x);
    expect(e1).toBeInstanceOf(BlueskyError);
    expect(e1).toMatchObject({ status: 429, retryAfterSeconds: 120 });
    const reset = String(at().getTime() / 1000 + 300);
    const e2 = await postText("https://p.example", session, "x", "k", async () => answer(429, {}, { "ratelimit-reset": reset }), at).catch((x) => x);
    expect(e2).toMatchObject({ status: 429, retryAfterSeconds: 300 });
    const e3 = await postText("https://p.example", session, "x", "k", async () => answer(429, {}), at).catch((x) => x);
    expect(e3).toMatchObject({ status: 429, retryAfterSeconds: 60 });
  });

  it("treats a 5xx or a malformed answer as not known, never as a refusal", async () => {
    const e1 = await postText("https://p.example", session, "x", "k", async () => answer(500, { error: "InternalServerError" })).catch((x) => x);
    expect(e1).toBeInstanceOf(Error);
    expect(e1).not.toBeInstanceOf(BlueskyError);
    const e2 = await postText("https://p.example", session, "x", "k", async () => answer(200, { nope: true })).catch((x) => x);
    expect(e2).toBeInstanceOf(Error);
    expect(e2).not.toBeInstanceOf(BlueskyError);
  });
});

const S32 = "234567abcdefghijklmnopqrstuvwxyz";
const decode = (s: string) => s.split("").reduce((n, c) => n * 32 + S32.indexOf(c), 0);

describe("tidFor", () => {
  const t = new Date("2026-11-14T12:00:00.123Z");

  it("gives the same valid TID for the same key and time", () => {
    const a = tidFor("post-1:acct-1", t);
    expect(a).toBe(tidFor("post-1:acct-1", new Date(t.getTime())));
    expect(a).toHaveLength(13);
    expect(a).toMatch(TID_REGEX);
  });

  it("decodes back to the time in microseconds", () => {
    const a = tidFor("post-1:acct-1", t);
    const micros = decode(a.slice(0, 11));
    expect(micros).toBeGreaterThanOrEqual(t.getTime() * 1000);
    expect(micros).toBeLessThan(t.getTime() * 1000 + 1000);
    expect(decode(a.slice(11))).toBeLessThan(1024);
    expect(decode(tidFor("k", new Date(0)).slice(0, 11))).toBeLessThan(1000);
    expect(tidFor("k", new Date(0))).toMatch(TID_REGEX);
  });

  it("gives different keys at the same time different clock ids, all valid", () => {
    const keys = ["post-1:acct-1", "post-1:acct-2", "post-2:acct-1", "post-3:acct-9"];
    const tids = keys.map((k) => tidFor(k, t));
    expect(new Set(tids).size).toBe(keys.length);
    for (const x of tids) expect(x).toMatch(TID_REGEX);
  });

  it("almost never repeats for different keys in the same millisecond", () => {
    // Two replies claimed in the same millisecond for one account must not share a record key.
    const tids = new Set(Array.from({ length: 1000 }, (_, i) => tidFor(`reply-${i}:acct-1`, t)));
    expect(tids.size).toBeGreaterThanOrEqual(995);
  });

  it("sorts by time like any TID", () => {
    expect(tidFor("k", new Date(t.getTime() + 1)) > tidFor("k", t)).toBe(true);
  });

  it("refuses a time before 1970, past the TID range, or invalid", () => {
    expect(() => tidFor("k", new Date(-1))).toThrow(RangeError);
    expect(() => tidFor("k", new Date(Math.floor(Number.MAX_SAFE_INTEGER / 1000) + 1))).toThrow(RangeError);
    expect(() => tidFor("k", new Date(Number.NaN))).toThrow(RangeError);
    expect(tidFor("k", new Date(Math.floor(Number.MAX_SAFE_INTEGER / 1000)))).toMatch(TID_REGEX);
  });
});

const notif = (n: number, over: Record<string, unknown> = {}) => ({
  uri: `at://did:plc:bob/app.bsky.feed.post/3m${n}`,
  cid: `bafy${n}`,
  author: { did: "did:plc:bob", handle: "bob.bsky.social", displayName: "Bob" },
  reason: "mention",
  record: { $type: "app.bsky.feed.post", text: `@ada.bsky.social question ${n}`, createdAt: "2026-11-15T08:00:00.000Z" },
  isRead: false,
  indexedAt: "2026-11-15T08:00:01.000Z",
  ...over,
});

describe("listMentions", () => {
  it("asks for mentions, replies and quotes with the token, 50 at a time, on the person's own server", async () => {
    const get = vi.fn<Get>(async () => answer(200, { notifications: [] }));
    const r = await listMentions("https://pds.example", session, undefined, get);
    expect(r).toEqual({ mentions: [], cursor: undefined });
    const [url, init] = get.mock.calls[0];
    expect(url.toString()).toBe("https://pds.example/xrpc/app.bsky.notification.listNotifications?reasons=mention&reasons=reply&reasons=quote&limit=50");
    expect(init.headers).toMatchObject({ authorization: "Bearer jwt-1" });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("sends the cursor back and returns the next one", async () => {
    const get = vi.fn<Get>(async () => answer(200, { cursor: "1731650000000::bafy9", notifications: [notif(1)] }));
    const r = await listMentions("https://pds.example", session, "1731660000000::bafy1", get);
    expect(get.mock.calls[0][0].searchParams.get("cursor")).toBe("1731660000000::bafy1");
    expect(r.cursor).toBe("1731650000000::bafy9");
  });

  it("returns each mention with its post's address, author, text and reason, and the thread root of a reply", async () => {
    const reply = notif(2, { reason: "reply", record: { $type: "app.bsky.feed.post", text: "yes?", createdAt: "x", reply: { root: { uri: "at://did:plc:ada123/app.bsky.feed.post/3root", cid: "bafyroot" }, parent: { uri: "at://p", cid: "bafyp" } } } });
    const r = await listMentions("https://pds.example", session, undefined, async () => answer(200, { notifications: [notif(1), reply] }));
    expect(r.mentions[0]).toEqual({ uri: "at://did:plc:bob/app.bsky.feed.post/3m1", cid: "bafy1", authorDid: "did:plc:bob", handle: "bob.bsky.social", text: "@ada.bsky.social question 1", reason: "mention", indexedAt: "2026-11-15T08:00:01.000Z" });
    expect(r.mentions[0]).not.toHaveProperty("root");
    expect(r.mentions[1]).toMatchObject({ reason: "reply", text: "yes?", root: { uri: "at://did:plc:ada123/app.bsky.feed.post/3root", cid: "bafyroot" } });
  });

  it("skips other reasons and malformed notifications, and reads a half root as no root", async () => {
    const r = await listMentions("https://pds.example", session, undefined, async () =>
      answer(200, { notifications: [notif(1, { reason: "like" }), notif(2, { cid: 5 }), notif(3, { author: { did: "did:plc:x" } }), notif(4, { record: { text: "hi", reply: { root: { uri: "at://r" } } } }), notif(5, { reason: "quote", record: {} })] }),
    );
    expect(r.mentions.map((m) => m.uri)).toEqual(["at://did:plc:bob/app.bsky.feed.post/3m4", "at://did:plc:bob/app.bsky.feed.post/3m5"]);
    expect(r.mentions[0]).not.toHaveProperty("root");
    expect(r.mentions[1].text).toBe("");
  });

  it("waits on a 429, refuses on a 4xx, and treats a 5xx or a malformed answer as not known", async () => {
    const e1 = await listMentions("https://p.example", session, undefined, async () => answer(429, { error: "RateLimitExceeded" }, { "retry-after": "30" }), at).catch((x) => x);
    expect(e1).toBeInstanceOf(BlueskyError);
    expect(e1).toMatchObject({ status: 429, retryAfterSeconds: 30 });
    const e2 = await listMentions("https://p.example", session, undefined, async () => answer(401, { error: "ExpiredToken", message: "Token has expired" })).catch((x) => x);
    expect(e2).toBeInstanceOf(BlueskyError);
    expect(e2.message).toContain("Connect the account again");
    const e3 = await listMentions("https://p.example", session, undefined, async () => answer(400, { error: "InvalidRequest", message: "The seenAt parameter is unsupported" })).catch((x) => x);
    expect(e3.message).toBe("Bluesky refused reading mentions: The seenAt parameter is unsupported");
    const e4 = await listMentions("https://p.example", session, undefined, async () => answer(502, {})).catch((x) => x);
    expect(e4).toBeInstanceOf(Error);
    expect(e4).not.toBeInstanceOf(BlueskyError);
    const e5 = await listMentions("https://p.example", session, undefined, async () => answer(200, { cursor: "c" })).catch((x) => x);
    expect(e5).not.toBeInstanceOf(BlueskyError);
  });

  it("never follows a redirect with the token: one request, the other host never asked, not a refusal", async () => {
    const get = vi.fn<Get>(async () => new Response(null, { status: 307, headers: { location: "https://evil.example/xrpc/steal" } }));
    const e = await listMentions("https://pds.example", session, undefined, get).catch((x) => x);
    expect(get).toHaveBeenCalledTimes(1);
    expect(get.mock.calls[0][0].hostname).toBe("pds.example");
    expect(e).toBeInstanceOf(Error);
    expect(e).not.toBeInstanceOf(BlueskyError);
  });

  it("reads through the guarded no-redirect GET by default, and passes on its refusal of a redirect", async () => {
    const { BlockedAddressError } = await vi.importActual<typeof import("./safe-fetch")>("./safe-fetch");
    safeGetSpy.mockRejectedValueOnce(new BlockedAddressError("The server answered with a redirect"));
    const e = await listMentions("https://pds.example", session).catch((x) => x);
    expect(safeGetSpy).toHaveBeenCalledTimes(1);
    expect(safeGetSpy.mock.calls[0][0].hostname).toBe("pds.example");
    expect(e).toBeInstanceOf(BlockedAddressError);
    expect(e).not.toBeInstanceOf(BlueskyError);
  });
});

describe("replyTo", () => {
  const parent = { uri: "at://did:plc:bob/app.bsky.feed.post/3m2", cid: "bafy2" };
  const root = { uri: "at://did:plc:ada123/app.bsky.feed.post/3root", cid: "bafyroot" };

  it("writes one post record with the reply's root and parent under the given key", async () => {
    const rkey = tidFor("reply:3m2", at());
    const post = vi.fn<Post>(async () => answer(200, { uri: `at://did:plc:ada123/app.bsky.feed.post/${rkey}`, cid: "bafyr" }));
    const r = await replyTo("https://pds.example", session, parent, root, "Yes, it is live.", rkey, post, at);
    expect(r).toEqual({ uri: `at://did:plc:ada123/app.bsky.feed.post/${rkey}`, link: `https://bsky.app/profile/did:plc:ada123/post/${rkey}` });
    const [url, init] = post.mock.calls[0];
    expect(url.toString()).toBe("https://pds.example/xrpc/com.atproto.repo.createRecord");
    expect(init.headers).toMatchObject({ authorization: "Bearer jwt-1", "content-type": "application/json" });
    expect(JSON.parse(init.body)).toEqual({
      repo: "did:plc:ada123",
      collection: "app.bsky.feed.post",
      rkey,
      record: { $type: "app.bsky.feed.post", text: "Yes, it is live.", reply: { root, parent }, createdAt: "2026-11-14T12:00:00.000Z" },
    });
  });

  it("refuses on a 4xx, waits on a 429, and treats a 5xx as not known", async () => {
    const e1 = await replyTo("https://p.example", session, parent, root, "x", "k", async () => answer(400, { error: "InvalidRequest", message: "Could not locate record" })).catch((x) => x);
    expect(e1).toBeInstanceOf(BlueskyError);
    expect(e1.message).toContain("Could not locate record");
    const e2 = await replyTo("https://p.example", session, parent, root, "x", "k", async () => answer(429, {}), at).catch((x) => x);
    expect(e2).toMatchObject({ status: 429, retryAfterSeconds: 60 });
    const e3 = await replyTo("https://p.example", session, parent, root, "x", "k", async () => answer(500, { error: "InternalServerError" })).catch((x) => x);
    expect(e3).not.toBeInstanceOf(BlueskyError);
  });
});

describe("keeping a session", () => {
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  it("keeps the refresh token from sign-in", async () => {
    const s = await createSession("https://pds.example", "ada.bsky.social", "app-pw", async () => json(200, { did: "did:plc:a", accessJwt: "acc1", refreshJwt: "ref1", handle: "ada.bsky.social" }));
    expect(s).toEqual({ did: "did:plc:a", accessJwt: "acc1", refreshJwt: "ref1" });
  });

  it("refreshes with the refresh token, never the access token, and returns the new pair", async () => {
    const post = vi.fn<Post>(async () => json(200, { did: "did:plc:a", accessJwt: "acc2", refreshJwt: "ref2", handle: "ada.bsky.social" }));
    const s = await refreshSession("https://pds.example", "ref1", post);
    expect(s).toEqual({ did: "did:plc:a", accessJwt: "acc2", refreshJwt: "ref2" });
    const [url, init] = post.mock.calls[0];
    expect(url.toString()).toBe("https://pds.example/xrpc/com.atproto.server.refreshSession");
    expect(init.headers).toMatchObject({ authorization: "Bearer ref1" });
  });

  it("knows an expired access token (400 ExpiredToken) from any other refusal", async () => {
    const expired = await postText("https://pds.example", { did: "d", accessJwt: "old" }, "x", "3jzfcijpj2z2a", async () => json(400, { error: "ExpiredToken", message: "Token has expired" })).catch((e) => e);
    expect(isExpiredToken(expired)).toBe(true);
    const other = await postText("https://pds.example", { did: "d", accessJwt: "a" }, "x", "3jzfcijpj2z2a", async () => json(400, { error: "InvalidRequest", message: "Text too long" })).catch((e) => e);
    expect(isExpiredToken(other)).toBe(false);
    expect(isExpiredToken(new Error("network"))).toBe(false);
  });
});
