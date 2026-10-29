import "server-only";
/**
 * Telegram echo: one shared Queue Pilot bot posts a copy of each sent Buffer post to the user's channel.
 * Connecting uses one shared bot, the common pattern for scheduling tools: the user adds the bot as a channel admin and posts "/connect <code>"; we find that message with getUpdates and keep
 * the chat id. Limits from core.telegram.org/bots/api: message text 4,096 characters, photo caption 1,024.
 */

import { createHmac } from "node:crypto";
import { fit } from "./text-fit";

export { fit };
export const TEXT_LIMIT = 4096;
export const CAPTION_LIMIT = 1024;

type Fetch = typeof fetch;

export class TelegramError extends Error {
  constructor(message: string, readonly retryAfterSeconds?: number) {
    super(message);
  }
}

async function call<T>(token: string, method: string, body: Record<string, unknown>, doFetch: Fetch): Promise<T> {
  const res = await doFetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  const json = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: T; description?: string; parameters?: { retry_after?: number } };
  if (!json.ok) throw new TelegramError(json.description ?? `Telegram answered ${res.status}`, json.parameters?.retry_after);
  return json.result as T;
}

type Update = {
  update_id: number;
  message?: { text?: string; chat: { id: number; title?: string; type: string } };
  channel_post?: { text?: string; chat: { id: number; title?: string; type: string } };
};

const WORDS = ["amber", "birch", "cedar", "delta", "ember", "fjord", "grove", "harbor", "indigo", "juniper", "kelp", "lumen", "maple", "nectar", "orbit", "pine"];

/**
 * The connect code for one user on one UTC day, derived with HMAC from a server secret: nothing to store, and only the
 * server can produce a user's code. Yesterday's code is also accepted so a code shown near midnight still works.
 */
export function connectCodeFor(userId: string, secret: string, day: Date): string {
  const d = day.toISOString().slice(0, 10);
  const h = createHmac("sha256", secret).update(`qp-telegram-connect|${userId}|${d}`).digest();
  return `${WORDS[h[0] % WORDS.length]}-${WORDS[h[1] % WORDS.length]}-${1000 + (h.readUInt16BE(2) % 9000)}`;
}

/** A connect code that is easy to type and hard to guess. */
export function newConnectCode(random: () => number = Math.random): string {
  const words = ["amber", "birch", "cedar", "delta", "ember", "fjord", "grove", "harbor", "indigo", "juniper", "kelp", "lumen", "maple", "nectar", "orbit", "pine"];
  const pick = () => words[Math.floor(random() * words.length)];
  return `${pick()}-${pick()}-${Math.floor(random() * 9000 + 1000)}`;
}

export type SeenCode = { code: string; chatId: number; title: string };

/** Every "/connect <code>" message among the updates, newest last. */
export function connectMessages(updates: Update[]): SeenCode[] {
  const out: SeenCode[] = [];
  for (const u of updates) {
    const m = u.channel_post ?? u.message;
    const match = /^\/connect(?:@\w+)?\s+([a-z]+-[a-z]+-\d{4})\s*$/i.exec((m?.text ?? "").trim());
    // Only channels and groups can receive copies; a private chat with the bot is where a copied code would be replayed.
    if (m && match && m.chat.type !== "private") out.push({ code: match[1].toLowerCase(), chatId: m.chat.id, title: m.chat.title ?? "your channel" });
  }
  return out;
}

/** At most this many pages of 100 per check: Telegram keeps unread updates for 24 hours. */
export const MAX_UPDATE_PAGES = 10;

/**
 * Reads every waiting update, oldest first, handing each page's connect messages to `keep` BEFORE asking for the next
 * page: a request with a higher offset confirms the earlier updates (core.telegram.org/bots/api#getupdates), so a
 * code is only forgotten by Telegram after it has been stored. Another user's code read here is stored too.
 */
export async function drainConnectCodes(token: string, keep: (codes: SeenCode[]) => Promise<void>, doFetch: Fetch = fetch): Promise<number> {
  let offset: number | undefined;
  let found = 0;
  for (let page = 0; page < MAX_UPDATE_PAGES; page++) {
    const updates = await call<Update[]>(token, "getUpdates", { allowed_updates: ["message", "channel_post"], limit: 100, ...(offset ? { offset } : {}) }, doFetch);
    if (updates.length === 0) break;
    const codes = connectMessages(updates);
    if (codes.length) await keep(codes);
    found += codes.length;
    offset = updates[updates.length - 1].update_id + 1;
    if (updates.length < 100) {
      // Confirm the last page too, so the next check starts after it.
      await call<Update[]>(token, "getUpdates", { offset, limit: 1, timeout: 0 }, doFetch);
      break;
    }
  }
  return found;
}


/**
 * Posts a copy to the channel: a photo with caption when the post has an image, else text with a link preview.
 * Returns the message id Telegram assigned, which is how we confirm the copy landed.
 */
export async function sendCopy(
  token: string,
  chatId: number,
  post: { text: string; imageUrl?: string | null; link?: string | null },
  doFetch: Fetch = fetch,
): Promise<{ messageId: number }> {
  const text = post.link && !post.text.includes(post.link) ? `${post.text}\n\n${post.link}` : post.text;
  if (post.imageUrl) {
    try {
      const r = await call<{ message_id: number }>(token, "sendPhoto", { chat_id: chatId, photo: post.imageUrl, caption: fit(text, CAPTION_LIMIT) }, doFetch);
      return { messageId: r.message_id };
    } catch (e) {
      // Telegram refuses some images (format, size). The text still goes out; a rate limit or a lost chat does not
      // fall back, because the text would fail the same way.
      if (!(e instanceof TelegramError) || e.retryAfterSeconds !== undefined || /chat not found|kicked|not enough rights/i.test(e.message)) throw e;
    }
  }
  const r = await call<{ message_id: number }>(token, "sendMessage", { chat_id: chatId, text: fit(text, TEXT_LIMIT) }, doFetch);
  return { messageId: r.message_id };
}
