import { describe, expect, it } from "vitest";
import { CONTENT_LIMIT, DiscordError, PERMISSIONS, defaultChannel, installState, stateMatches, exchangeInstall, installUrl, postableChannels, sendCopy, canPost, postText, messageUrl } from "./discord";

function fakeDiscord(answer: (url: string, init: any) => { status: number; body: unknown }) {
  const calls: { url: string; init: any }[] = [];
  const doFetch = (async (url: string, init: any = {}) => {
    calls.push({ url, init });
    const a = answer(url, init);
    return { ok: a.status < 400, status: a.status, json: async () => a.body };
  }) as any;
  return { doFetch, calls };
}

describe("installing the bot", () => {
  it("asks only for view, send, embed links and attach files", () => {
    expect(PERMISSIONS).toBe("52224");
  });

  it("builds the Add to server link with state and redirect", () => {
    const u = new URL(installUrl({ clientId: "123", redirectUri: "https://qp.example/discord/callback", state: "s1" }));
    expect(u.origin + u.pathname).toBe("https://discord.com/oauth2/authorize");
    expect(Object.fromEntries(u.searchParams)).toEqual({ client_id: "123", scope: "bot", permissions: "52224", response_type: "code", redirect_uri: "https://qp.example/discord/callback", state: "s1" });
  });

  it("takes the server from the code exchange, not from the redirect's hint", async () => {
    const { doFetch, calls } = fakeDiscord(() => ({ status: 200, body: { access_token: "x", guild: { id: "g1", name: "Pennyrow" } } }));
    expect(await exchangeInstall("code1", { clientId: "123", clientSecret: "sec", redirectUri: "https://qp.example/cb" }, doFetch)).toEqual({ guildId: "g1", guildName: "Pennyrow" });
    expect(calls[0].url).toBe("https://discord.com/api/v10/oauth2/token");
    expect(String(calls[0].init.body)).toContain("grant_type=authorization_code");
  });

  it("refuses an exchange that names no server", async () => {
    const { doFetch } = fakeDiscord(() => ({ status: 200, body: { access_token: "x" } }));
    await expect(exchangeInstall("c", { clientId: "1", clientSecret: "s", redirectUri: "r" }, doFetch)).rejects.toBeInstanceOf(DiscordError);
  });
});

describe("posting", () => {
  it("lists text and announcement channels only, in server order", async () => {
    const { doFetch } = fakeDiscord(() => ({
      status: 200,
      body: [
        { id: "v", name: "voice", type: 2, position: 0 },
        { id: "a", name: "announcements", type: 5, position: 2 },
        { id: "g", name: "general", type: 0, position: 1 },
      ],
    }));
    expect(await postableChannels("B", "g1", doFetch)).toEqual([{ id: "g", name: "general" }, { id: "a", name: "announcements" }]);
  });

  it("posts with mentions switched off and the image as an embed", async () => {
    const { doFetch, calls } = fakeDiscord(() => ({ status: 200, body: { id: "m1" } }));
    expect(await sendCopy("B", "c1", { text: "@everyone CSV export is live", imageUrl: "https://img.example/a.png" }, doFetch)).toEqual({ messageId: "m1" });
    const body = JSON.parse(calls[0].init.body);
    expect(calls[0].init.headers.authorization).toBe("Bot B");
    expect(body.allowed_mentions).toEqual({ parse: [] });
    expect(body.embeds).toEqual([{ image: { url: "https://img.example/a.png" } }]);
  });

  it("keeps content within Discord's 2,000 limit", async () => {
    const { doFetch, calls } = fakeDiscord(() => ({ status: 200, body: { id: "m2" } }));
    await sendCopy("B", "c1", { text: "word ".repeat(600) }, doFetch);
    expect(JSON.parse(calls[0].init.body).content.length).toBeLessThanOrEqual(CONTENT_LIMIT);
  });

  it("surfaces Discord's message and retry_after on 429", async () => {
    const { doFetch } = fakeDiscord(() => ({ status: 429, body: { message: "You are being rate limited.", retry_after: 1.5 } }));
    const err = await sendCopy("B", "c1", { text: "hi" }, doFetch).catch((e) => e);
    expect(err).toBeInstanceOf(DiscordError);
    expect(err.retryAfterSeconds).toBe(1.5);
  });
});

describe("install state", () => {
  const secret = "s".repeat(32);
  const now = new Date("2026-11-03T10:00:00Z");
  it("accepts today's and yesterday's state for the same user only", () => {
    expect(stateMatches(installState("u1", secret, now), "u1", secret, now)).toBe(true);
    expect(stateMatches(installState("u1", secret, new Date("2026-11-02T23:00:00Z")), "u1", secret, now)).toBe(true);
    expect(stateMatches(installState("u1", secret, new Date("2026-11-01T10:00:00Z")), "u1", secret, now)).toBe(false);
    expect(stateMatches(installState("u2", secret, now), "u1", secret, now)).toBe(false);
    expect(stateMatches("garbage", "u1", secret, now)).toBe(false);
  });
});

describe("defaultChannel", () => {
  it("prefers an announcements channel, else the first", () => {
    expect(defaultChannel([{ id: "g", name: "general" }, { id: "a", name: "📢announcements" }])).toEqual({ id: "a", name: "📢announcements" });
    expect(defaultChannel([{ id: "g", name: "general" }])).toEqual({ id: "g", name: "general" });
    expect(defaultChannel([])).toBeNull();
  });
});

describe("canPost, Discord's documented permission order", () => {
  const guildId = "g";
  const VIEW = String(1 << 10), SEND = String(1 << 11), BOTH = String((1 << 10) | (1 << 11)), ADMIN = String(1 << 3);
  const base = { guildId, memberId: "bot", memberRoles: ["botrole"], roles: [{ id: "g", permissions: VIEW }, { id: "botrole", permissions: SEND }] };

  it("allows a channel with no overwrites when @everyone and the bot's role together give view and send", () => {
    expect(canPost({ ...base, overwrites: [] })).toBe(true);
  });
  it("refuses when the channel's @everyone overwrite denies sending", () => {
    expect(canPost({ ...base, overwrites: [{ id: "g", type: 0, allow: "0", deny: SEND }] })).toBe(false);
  });
  it("lets a role overwrite allow what @everyone's overwrite denied", () => {
    expect(canPost({ ...base, overwrites: [{ id: "g", type: 0, allow: "0", deny: BOTH }, { id: "botrole", type: 0, allow: BOTH, deny: "0" }] })).toBe(true);
  });
  it("lets the member's own overwrite deny what a role allowed", () => {
    expect(canPost({ ...base, overwrites: [{ id: "botrole", type: 0, allow: BOTH, deny: "0" }, { id: "bot", type: 1, allow: "0", deny: SEND }] })).toBe(false);
  });
  it("ignores overwrites for roles the bot does not have", () => {
    expect(canPost({ ...base, overwrites: [{ id: "otherrole", type: 0, allow: "0", deny: BOTH }] })).toBe(true);
  });
  it("needs view as well as send", () => {
    expect(canPost({ ...base, roles: [{ id: "g", permissions: "0" }, { id: "botrole", permissions: SEND }], overwrites: [] })).toBe(false);
  });
  it("allows everything for an administrator role, whatever the overwrites", () => {
    expect(canPost({ ...base, roles: [{ id: "g", permissions: "0" }, { id: "botrole", permissions: ADMIN }], overwrites: [{ id: "bot", type: 1, allow: "0", deny: BOTH }] })).toBe(true);
  });
});

describe("postText", () => {
  it("refuses text over the limit before sending anything", async () => {
    let called = false;
    await expect(postText("t", "c", "x".repeat(2001), async () => { called = true; return new Response("{}"); })).rejects.toThrow(/up to 2000 characters/);
    expect(called).toBe(false);
  });
  it("sends the text unchanged with mentions off and returns the message id", async () => {
    let body: Record<string, unknown> = {};
    const out = await postText("t", "c1", "Patch 1.4 is out @everyone", async (_u, init) => { body = JSON.parse(String(init?.body)); return new Response(JSON.stringify({ id: "m1" })); });
    expect(body).toEqual({ content: "Patch 1.4 is out @everyone", allowed_mentions: { parse: [] } });
    expect(out).toEqual({ messageId: "m1" });
    expect(messageUrl("g", "c1", "m1")).toBe("https://discord.com/channels/g/c1/m1");
  });
});

describe("an answer that may still have posted", () => {
  it("is not a refusal when Discord answers 5xx or with no message id", async () => {
    const e1 = await postText("t", "c", "hi", async () => new Response("bad gateway", { status: 502 })).catch((e) => e);
    expect(e1).toBeInstanceOf(Error);
    expect(e1).not.toBeInstanceOf(DiscordError);
    const e2 = await postText("t", "c", "hi", async () => new Response("{}", { status: 200 })).catch((e) => e);
    expect(e2).not.toBeInstanceOf(DiscordError);
  });
  it("is a refusal when Discord answers 4xx with its reason", async () => {
    const e = await postText("t", "c", "hi", async () => new Response(JSON.stringify({ message: "Missing Permissions" }), { status: 403 })).catch((e) => e);
    expect(e).toBeInstanceOf(DiscordError);
  });
});

