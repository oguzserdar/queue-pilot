import { describe, expect, it } from "vitest";
import { CAPTION_LIMIT, TelegramError, connectCodeFor, connectMessages, drainConnectCodes, fit, newConnectCode, sendCopy } from "./telegram";

function fakeTelegram(answer: (method: string, body: any) => unknown) {
  const calls: { method: string; body: any }[] = [];
  const doFetch = (async (url: string, init: { body: string }) => {
    const method = url.split("/").pop() as string;
    const body = JSON.parse(init.body);
    calls.push({ method, body });
    return { status: 200, json: async () => answer(method, body) };
  }) as any;
  return { doFetch, calls };
}

describe("connecting a channel", () => {
  it("makes readable codes", () => {
    expect(newConnectCode(() => 0)).toBe("amber-amber-1000");
    expect(newConnectCode()).toMatch(/^[a-z]+-[a-z]+-\d{4}$/);
  });

  it("picks out every connect message, also with the bot's name after /connect", () => {
    const updates = [
      { update_id: 1, channel_post: { text: "hello", chat: { id: -1, title: "Other", type: "channel" } } },
      { update_id: 2, channel_post: { text: "/connect maple-orbit-4821", chat: { id: -1001, title: "Pennyrow news", type: "channel" } } },
      { update_id: 3, message: { text: "/connect@QueuePilotBot Amber-Pine-1234", chat: { id: 42, title: "G", type: "group" } } },
      { update_id: 4, channel_post: { text: "/connect not-a-code", chat: { id: 7, type: "channel" } } },
      { update_id: 5, message: { text: "/connect maple-orbit-4821", chat: { id: 999, type: "private" } } },
    ];
    expect(connectMessages(updates)).toEqual([
      { code: "maple-orbit-4821", chatId: -1001, title: "Pennyrow news" },
      { code: "amber-pine-1234", chatId: 42, title: "G" },
    ]);
  });

  it("reads past the first 100 waiting updates and confirms what it read", async () => {
    // 150 waiting channel posts, the code is number 140: a single getUpdates call would never see it.
    const all = Array.from({ length: 150 }, (_, i) => ({
      update_id: 1000 + i,
      channel_post: { text: i === 139 ? "/connect maple-orbit-4821" : `post ${i}`, chat: { id: -100 - i, title: `C${i}`, type: "channel" } },
    }));
    const { doFetch, calls } = fakeTelegram((_m, body) => {
      const from = body.offset ?? 1000;
      return { ok: true, result: all.filter((u) => u.update_id >= from).slice(0, body.limit ?? 100) };
    });
    const kept: unknown[] = [];
    expect(await drainConnectCodes("T", async (c) => void kept.push(...c), doFetch)).toBe(1);
    expect(kept).toEqual([{ code: "maple-orbit-4821", chatId: -239, title: "C139" }]);
    expect(calls.map((c) => c.body.offset)).toEqual([undefined, 1100, 1150]);
  });

  it("does not confirm a page when storing its codes failed, so Telegram keeps them", async () => {
    const all = [{ update_id: 7, channel_post: { text: "/connect maple-orbit-4821", chat: { id: -1, title: "C", type: "channel" } } }];
    const { doFetch, calls } = fakeTelegram((_m, body) => ({ ok: true, result: all.filter((u) => u.update_id >= (body.offset ?? 0)) }));
    await expect(drainConnectCodes("T", async () => { throw new Error("database down"); }, doFetch)).rejects.toThrow("database down");
    // Only the first read happened; no request with a higher offset was sent.
    expect(calls.map((c) => c.body.offset)).toEqual([undefined]);
  });
});

describe("sending a copy", () => {
  it("sends text with the link added once", async () => {
    const { doFetch, calls } = fakeTelegram(() => ({ ok: true, result: { message_id: 55 } }));
    expect(await sendCopy("T", 7, { text: "CSV export is live.", link: "https://x.com/p/1" }, doFetch)).toEqual({ messageId: 55 });
    expect(calls[0]).toEqual({ method: "sendMessage", body: { chat_id: 7, text: "CSV export is live.\n\nhttps://x.com/p/1" } });
  });

  it("sends a photo with a caption cut to Telegram's 1,024 limit", async () => {
    const { doFetch, calls } = fakeTelegram(() => ({ ok: true, result: { message_id: 56 } }));
    await sendCopy("T", 7, { text: "word ".repeat(400), imageUrl: "https://img.example/a.png" }, doFetch);
    expect(calls[0].method).toBe("sendPhoto");
    expect(calls[0].body.caption.length).toBeLessThanOrEqual(CAPTION_LIMIT);
    expect(calls[0].body.caption.endsWith("…")).toBe(true);
  });

  it("sends the text when Telegram refuses the image", async () => {
    const { doFetch, calls } = fakeTelegram((method) =>
      method === "sendPhoto" ? { ok: false, description: "Bad Request: wrong file identifier/HTTP URL specified" } : { ok: true, result: { message_id: 57 } },
    );
    expect(await sendCopy("T", 7, { text: "hi", imageUrl: "https://img.example/a.webp" }, doFetch)).toEqual({ messageId: 57 });
    expect(calls.map((c) => c.method)).toEqual(["sendPhoto", "sendMessage"]);
  });

  it("does not fall back on a rate limit or a lost chat", async () => {
    const limited = fakeTelegram(() => ({ ok: false, description: "Too Many Requests: retry after 5", parameters: { retry_after: 5 } }));
    await expect(sendCopy("T", 7, { text: "hi", imageUrl: "https://i.example/a.png" }, limited.doFetch)).rejects.toThrow("Too Many");
    expect(limited.calls).toHaveLength(1);
    const gone = fakeTelegram(() => ({ ok: false, description: "Bad Request: chat not found" }));
    await expect(sendCopy("T", 7, { text: "hi", imageUrl: "https://i.example/a.png" }, gone.doFetch)).rejects.toThrow("chat not found");
    expect(gone.calls).toHaveLength(1);
  });

  it("surfaces Telegram's own error and its retry_after", async () => {
    const { doFetch } = fakeTelegram(() => ({ ok: false, description: "Too Many Requests: retry after 12", parameters: { retry_after: 12 } }));
    const err = await sendCopy("T", 7, { text: "hi" }, doFetch).catch((e) => e);
    expect(err).toBeInstanceOf(TelegramError);
    expect(err.message).toBe("Too Many Requests: retry after 12");
    expect(err.retryAfterSeconds).toBe(12);
  });
});

describe("fit", () => {
  it("leaves short text alone and cuts long text at a word", () => {
    expect(fit("short", 10)).toBe("short");
    expect(fit("one two three four five", 20)).toBe("one two three four…");
    // A word boundary that would waste most of the room is not used: the cut stays mid-word.
    expect(fit("one supercalifragilistic", 12)).toBe("one superca…");
  });
});

describe("connectCodeFor", () => {
  const day = new Date("2026-11-03T15:00:00Z");
  it("is stable for a user and day, and differs by user, day and secret", () => {
    const a = connectCodeFor("u1", "s".repeat(32), day);
    expect(a).toMatch(/^[a-z]+-[a-z]+-\d{4}$/);
    expect(connectCodeFor("u1", "s".repeat(32), new Date("2026-11-03T01:00:00Z"))).toBe(a);
    expect(connectCodeFor("u2", "s".repeat(32), day)).not.toBe(a);
    expect(connectCodeFor("u1", "s".repeat(32), new Date("2026-11-04T01:00:00Z"))).not.toBe(a);
    expect(connectCodeFor("u1", "t".repeat(32), day)).not.toBe(a);
  });
});
