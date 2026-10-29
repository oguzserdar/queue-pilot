import { describe, expect, it } from "vitest";
import type { Post } from "./buffer/queries";
import { memoryEchoStore } from "./echo-store";
import { botTokensFromEnv, echoForUser, type Senders } from "./echo-run";

const now = new Date("2026-11-03T12:00:00Z");
const sent = (id: string, sentAt = "2026-11-03T09:00:05Z"): Post => ({ id, channelId: "x", status: "sent", text: `post ${id}`, dueAt: sentAt, sentAt, externalLink: `https://x.com/p/${id}`, error: null });

function fakeSenders() {
  const calls: string[] = [];
  const senders: Senders = {
    telegram: async (_t, chatId, post) => (calls.push(`tg ${chatId} ${post.text} ${post.link}${post.imageUrl ? ` ${post.imageUrl}` : ""}`), { messageId: 1 }),
    discord: async (_t, channelId, post) => (calls.push(`dc ${channelId} ${post.text}`), { messageId: "m" }),
  };
  return { senders, calls };
}

async function storeWith() {
  const store = memoryEchoStore(() => new Date("2026-11-01T00:00:00Z"));
  await store.setDestination("u1", { kind: "telegram", label: "Pennyrow news", target: "-1001" });
  await store.setDestination("u1", { kind: "discord", label: "#announcements", target: "c1", guildId: "g1" });
  return store;
}

describe("echoForUser", () => {
  it("copies a sent post to both destinations, with its link", async () => {
    const store = await storeWith();
    const { senders, calls } = fakeSenders();
    const out = await echoForUser("u1", [sent("p1")], { store, tokens: { telegram: "T", discord: "D" }, now, senders });
    expect(out.map((r) => r.status)).toEqual(["sent", "sent"]);
    expect(calls).toEqual(["tg -1001 post p1 https://x.com/p/p1", "dc c1 post p1"]);
  });

  it("does not send again on the next run", async () => {
    const store = await storeWith();
    const { senders, calls } = fakeSenders();
    await echoForUser("u1", [sent("p1")], { store, tokens: { telegram: "T", discord: "D" }, now, senders });
    await echoForUser("u1", [sent("p1")], { store, tokens: { telegram: "T", discord: "D" }, now, senders });
    expect(calls).toHaveLength(2);
  });

  it("skips a destination whose bot is not configured", async () => {
    const store = await storeWith();
    const { senders, calls } = fakeSenders();
    await echoForUser("u1", [sent("p1")], { store, tokens: { discord: "D" }, now, senders });
    expect(calls).toEqual(["dc c1 post p1"]);
  });

  it("does nothing when the user has no destinations", async () => {
    const { senders, calls } = fakeSenders();
    expect(await echoForUser("u2", [sent("p1")], { store: memoryEchoStore(), tokens: { telegram: "T", discord: "D" }, now, senders })).toEqual([]);
    expect(calls).toEqual([]);
  });
});

describe("botTokensFromEnv", () => {
  it("treats empty values as missing", () => {
    expect(botTokensFromEnv({ TELEGRAM_BOT_TOKEN: "", DISCORD_BOT_TOKEN: "d" } as unknown as NodeJS.ProcessEnv)).toEqual({ telegram: undefined, discord: "d" });
  });
});

describe("two runs at the same moment", () => {
  it("send each copy once", async () => {
    const store = await storeWith();
    const { senders, calls } = fakeSenders();
    const deps = { store, tokens: { telegram: "T", discord: "D" }, now, senders };
    await Promise.all([echoForUser("u1", [sent("p1")], deps), echoForUser("u1", [sent("p1")], deps)]);
    expect(calls).toHaveLength(2);
  });

  it("let a later run retry a copy whose claim expired without landing", async () => {
    const store = await storeWith();
    const [tg] = await store.destinations("u1");
    expect(await store.claim("u1", "p1", tg.id, now, new Date(now.getTime() + 1000))).toBe(true);
    expect(await store.claim("u1", "p1", tg.id, now, new Date(now.getTime() + 1000))).toBe(false);
    expect(await store.claim("u1", "p1", tg.id, new Date(now.getTime() + 2000), new Date(now.getTime() + 3000))).toBe(true);
  });
});

describe("copies with an image", () => {
  it("send the post's image along", async () => {
    const store = await storeWith();
    const { senders, calls } = fakeSenders();
    const p = { ...sent("p1"), assets: [{ type: "image" as const, mimeType: "image/png", source: "https://i.example/a.png" }] };
    await echoForUser("u1", [p], { store, tokens: { telegram: "T" }, now, senders });
    expect(calls).toEqual(["tg -1001 post p1 https://x.com/p/p1 https://i.example/a.png"]);
  });
});
