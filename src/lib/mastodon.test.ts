/**
 * @fileoverview Mastodon with a fake instance: posting (the exact request, the link back, a refusal, a rate limit with
 * its wait, an answer that may or may not have landed), reading mentions (the exact request, the min_id cursor taken
 * from the Link header, HTML to plain text, refusals, and no redirect followed with the token) and replying.
 */
import { describe, expect, it, vi } from "vitest";
import { htmlToText, listMentions, MastodonError, postStatus, replyTo, type Get, type Post } from "./mastodon";

vi.mock("server-only", () => ({}));
const safeGetSpy = vi.hoisted(() => vi.fn<typeof import("./safe-fetch").safeGet>());
vi.mock("./safe-fetch", async (importOriginal) => ({ ...(await importOriginal<object>()), safeGet: safeGetSpy }));

const answer = (status: number, body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

describe("postStatus", () => {
  it("sends the exact text as public with the token and idempotency key, and returns the link", async () => {
    const post = vi.fn<Post>(async () => answer(200, { id: "1101", url: "https://mastodon.example/@ada/1101" }));
    const r = await postStatus("https://mastodon.example", "tok", "Ships today.", "qp-1:acct-1", post);
    expect(r).toEqual({ id: "1101", link: "https://mastodon.example/@ada/1101" });
    const [url, init] = post.mock.calls[0];
    expect(url.toString()).toBe("https://mastodon.example/api/v1/statuses");
    expect(init.headers).toMatchObject({ authorization: "Bearer tok", "idempotency-key": "qp-1:acct-1" });
    expect(JSON.parse(init.body)).toEqual({ status: "Ships today.", visibility: "public" });
  });

  it("returns no link when the instance gives none", async () => {
    const r = await postStatus("https://m.example", "t", "x", "k", async () => answer(200, { id: "2", url: null }));
    expect(r.link).toBeNull();
  });

  it("turns a 4xx into a refusal, and a sign-in refusal says to connect again", async () => {
    await expect(postStatus("https://m.example", "t", "x", "k", async () => answer(422, { error: "Text is too long" }))).rejects.toMatchObject({ status: 422, message: expect.stringContaining("Text is too long") });
    const e = await postStatus("https://m.example", "t", "x", "k", async () => answer(401, { error: "The access token is invalid" })).catch((x) => x);
    expect(e).toBeInstanceOf(MastodonError);
    expect(e.message).toMatch(/Connect the account again/);
    expect(e.message).not.toContain("t\"");
  });

  it("reads a rate limit's wait from X-RateLimit-Reset", async () => {
    const now = () => new Date("2026-11-15T10:00:00Z");
    const e = await postStatus("https://m.example", "t", "x", "k", async () => answer(429, { error: "Too many requests" }, { "x-ratelimit-reset": "2026-11-15T10:05:00Z" }), now).catch((x) => x);
    expect(e).toMatchObject({ status: 429, retryAfterSeconds: 300 });
  });

  it("treats a 5xx or a malformed answer as not known, never as a refusal", async () => {
    const e1 = await postStatus("https://m.example", "t", "x", "k", async () => answer(502, {})).catch((x) => x);
    expect(e1).not.toBeInstanceOf(MastodonError);
    const e2 = await postStatus("https://m.example", "t", "x", "k", async () => answer(200, { nope: true })).catch((x) => x);
    expect(e2).not.toBeInstanceOf(MastodonError);
  });
});

const mention = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  type: "mention",
  created_at: "2026-11-15T09:00:00.000Z",
  account: { id: "77", acct: "bob@other.example" },
  status: {
    id: `s${id}`,
    uri: `https://other.example/users/bob/statuses/s${id}`,
    url: `https://other.example/@bob/s${id}`,
    created_at: "2026-11-15T08:59:59.000Z",
    content: '<p><span class="h-card" translate="no"><a href="https://mastodon.example/@ada" class="u-url mention">@<span>ada</span></a></span> is this live?</p>',
    visibility: "public",
    in_reply_to_id: null,
    account: { id: "77", acct: "bob@other.example" },
    ...over,
  },
});

describe("listMentions", () => {
  it("asks for mentions only, 80 at a time, with the token and no cursor on the first call", async () => {
    const get = vi.fn<Get>(async () => answer(200, []));
    const r = await listMentions("https://mastodon.example", "tok", undefined, get);
    expect(r).toEqual({ mentions: [], nextSinceId: undefined });
    const [url, init] = get.mock.calls[0];
    expect(url.toString()).toBe("https://mastodon.example/api/v1/notifications?types%5B%5D=mention&limit=80");
    expect(init.headers).toMatchObject({ authorization: "Bearer tok" });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("pages forward with min_id, never since_id, and takes the next cursor from the rel=prev link", async () => {
    const link = '<https://mastodon.example/api/v1/notifications?limit=80&max_id=104&types%5B%5D=mention>; rel="next", <https://mastodon.example/api/v1/notifications?limit=80&min_id=105&types%5B%5D=mention>; rel="prev"';
    const get = vi.fn<Get>(async () => answer(200, [mention("105"), mention("104")], { link }));
    const r = await listMentions("https://mastodon.example", "tok", "100", get);
    const [url] = get.mock.calls[0];
    expect(url.searchParams.get("min_id")).toBe("100");
    expect(url.searchParams.has("since_id")).toBe(false);
    expect(r.nextSinceId).toBe("105");
    expect(r.mentions.map((m) => m.id)).toEqual(["105", "104"]);
  });

  it("falls back to the newest id on the page without a Link header, and keeps the cursor on an empty page", async () => {
    const r1 = await listMentions("https://m.example", "t", "100", async () => answer(200, [mention("9a"), mention("8z")]));
    expect(r1.nextSinceId).toBe("9a");
    const r2 = await listMentions("https://m.example", "t", "100", async () => answer(200, []));
    expect(r2.nextSinceId).toBe("100");
  });

  it("moves the cursor past a notification it skips, so a skipped one never repeats", async () => {
    const r = await listMentions("https://m.example", "t", "100", async () => answer(200, [{ id: "102", type: "mention", status: null }, mention("101")]));
    expect(r.mentions.map((m) => m.id)).toEqual(["101"]);
    expect(r.nextSinceId).toBe("102");
  });

  it("returns each mention with the status to reply to, its author, plain text, link and visibility", async () => {
    const r = await listMentions("https://m.example", "t", undefined, async () => answer(200, [mention("5", { visibility: "direct", in_reply_to_id: "4", url: null })]));
    expect(r.mentions[0]).toEqual({
      id: "5",
      statusId: "s5",
      accountId: "77",
      acct: "bob@other.example",
      text: "@ada is this live?",
      url: "https://other.example/users/bob/statuses/s5",
      createdAt: "2026-11-15T08:59:59.000Z",
      visibility: "direct",
      inReplyToId: "4",
    });
  });

  it("reads a rate limit's wait, turns a 4xx into a refusal, and a 5xx or a non-list into not known", async () => {
    const now = () => new Date("2026-11-15T10:00:00Z");
    const e1 = await listMentions("https://m.example", "t", undefined, async () => answer(429, {}, { "x-ratelimit-reset": "2026-11-15T10:01:00Z" }), now).catch((x) => x);
    expect(e1).toBeInstanceOf(MastodonError);
    expect(e1).toMatchObject({ status: 429, retryAfterSeconds: 60 });
    const e2 = await listMentions("https://m.example", "t", undefined, async () => answer(401, { error: "The access token is invalid" })).catch((x) => x);
    expect(e2).toBeInstanceOf(MastodonError);
    expect(e2.message).toMatch(/Connect the account again/);
    const e3 = await listMentions("https://m.example", "t", undefined, async () => answer(403, { error: "This action is outside the authorized scopes" })).catch((x) => x);
    expect(e3).toMatchObject({ status: 403 });
    const e4 = await listMentions("https://m.example", "t", undefined, async () => answer(503, {})).catch((x) => x);
    expect(e4).toBeInstanceOf(Error);
    expect(e4).not.toBeInstanceOf(MastodonError);
    const e5 = await listMentions("https://m.example", "t", undefined, async () => answer(200, { error: "x" })).catch((x) => x);
    expect(e5).not.toBeInstanceOf(MastodonError);
  });

  it("never follows a redirect with the token: one request, the other host never asked, not a refusal", async () => {
    const get = vi.fn<Get>(async () => new Response(null, { status: 302, headers: { location: "https://evil.example/steal" } }));
    const e = await listMentions("https://m.example", "tok", undefined, get).catch((x) => x);
    expect(get).toHaveBeenCalledTimes(1);
    expect(get.mock.calls[0][0].hostname).toBe("m.example");
    expect(e).toBeInstanceOf(Error);
    expect(e).not.toBeInstanceOf(MastodonError);
  });

  it("reads through the guarded no-redirect GET by default, and passes on its refusal of a redirect", async () => {
    const { BlockedAddressError } = await vi.importActual<typeof import("./safe-fetch")>("./safe-fetch");
    safeGetSpy.mockRejectedValueOnce(new BlockedAddressError("The server answered with a redirect"));
    const e = await listMentions("https://m.example", "tok").catch((x) => x);
    expect(safeGetSpy).toHaveBeenCalledTimes(1);
    expect(safeGetSpy.mock.calls[0][0].toString()).toBe("https://m.example/api/v1/notifications?types%5B%5D=mention&limit=80");
    expect(e).toBeInstanceOf(BlockedAddressError);
    expect(e).not.toBeInstanceOf(MastodonError);
  });
});

describe("htmlToText", () => {
  it("keeps paragraphs and line breaks, drops tags, and decodes entities once", () => {
    expect(htmlToText("<p>one &amp; two<br>three</p><p>&lt;b&gt; &quot;x&quot; &#39;y&#39; &#x1F600; &amp;lt;</p>")).toBe("one & two\nthree\n\n<b> \"x\" 'y' \u{1F600} &lt;");
  });

  it("reads tags once, so escaped or broken markup stays as text and is never read again as a tag", () => {
    expect(htmlToText("<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>")).toBe("<script>alert(1)</script>");
    expect(htmlToText("<p>a <scr<i>ipt> b</p>")).toBe("a ipt> b");
    expect(htmlToText("<p>1 &lt; 2 and 3 &gt; 2</p>")).toBe("1 < 2 and 3 > 2");
  });

  it("puts each list item and quote on its own line", () => {
    expect(htmlToText("<p>Steps:</p><ul><li>one</li><li>two</li></ul><blockquote><p>quoted</p></blockquote>")).toBe("Steps:\n\none\ntwo\n\nquoted");
  });

  it("keeps a shortened link as its full address and a mention as @name", () => {
    const html = '<p>See <a href="https://example.com/a/very/long/path" target="_blank" rel="nofollow noopener" translate="no"><span class="invisible">https://</span><span class="ellipsis">example.com/a/very/lo</span><span class="invisible">ng/path</span></a> <span class="h-card" translate="no"><a href="https://m.example/@ada" class="u-url mention">@<span>ada</span></a></span></p>';
    expect(htmlToText(html)).toBe("See https://example.com/a/very/long/path @ada");
  });
});

describe("replyTo", () => {
  it("replies to the status with the exact text, the given visibility and the idempotency key", async () => {
    const post = vi.fn<Post>(async () => answer(200, { id: "2201", url: "https://mastodon.example/@ada/2201" }));
    const r = await replyTo("https://mastodon.example", "tok", "s5", "@bob@other.example yes, it is live.", "reply-5", "direct", post);
    expect(r).toEqual({ id: "2201", link: "https://mastodon.example/@ada/2201" });
    const [url, init] = post.mock.calls[0];
    expect(url.toString()).toBe("https://mastodon.example/api/v1/statuses");
    expect(init.headers).toMatchObject({ authorization: "Bearer tok", "idempotency-key": "reply-5", "content-type": "application/json" });
    expect(JSON.parse(init.body)).toEqual({ status: "@bob@other.example yes, it is live.", in_reply_to_id: "s5", visibility: "direct" });
  });

  it("refuses on a 4xx naming the reply, waits on a 429, and treats a 5xx as not known", async () => {
    const e1 = await replyTo("https://m.example", "t", "s1", "x", "k", "public", async () => answer(404, { error: "Record not found" })).catch((x) => x);
    expect(e1).toBeInstanceOf(MastodonError);
    expect(e1).toMatchObject({ status: 404 });
    expect(e1.message).toBe("Mastodon refused the reply: Record not found");
    const e2 = await replyTo("https://m.example", "t", "s1", "x", "k", "public", async () => answer(429, {})).catch((x) => x);
    expect(e2).toMatchObject({ status: 429, retryAfterSeconds: 60 });
    const e3 = await replyTo("https://m.example", "t", "s1", "x", "k", "public", async () => answer(500, {})).catch((x) => x);
    expect(e3).not.toBeInstanceOf(MastodonError);
  });
});
