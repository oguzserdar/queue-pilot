import "server-only";
/**
 * Discord echo: the Queue Pilot bot posts a copy of each sent Buffer post to a channel the user picks.
 * Installed with Discord's bot authorization flow (docs.discord.com/developers/topics/oauth2). The guild_id on the
 * redirect "should only be used as a hint", so the server is taken from the code exchange, and the state is bound to
 * the signed-in user by the caller: nobody can point the bot at a server they did not add it to.
 * Permissions (docs.discord.com/developers/topics/permissions): VIEW_CHANNEL 1<<10, SEND_MESSAGES 1<<11,
 * EMBED_LINKS 1<<14, ATTACH_FILES 1<<15. Message content is limited to 2,000 characters.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { fit } from "./text-fit";

export const PERMISSIONS = String((1 << 10) | (1 << 11) | (1 << 14) | (1 << 15));
export const CONTENT_LIMIT = 2000;
const API = "https://discord.com/api/v10";

type Fetch = typeof fetch;

export class DiscordError extends Error {
  constructor(message: string, readonly retryAfterSeconds?: number) {
    super(message);
  }
}

/** The "Add to server" link. */
export function installUrl(o: { clientId: string; redirectUri: string; state: string }): string {
  const q = new URLSearchParams({ client_id: o.clientId, scope: "bot", permissions: PERMISSIONS, response_type: "code", redirect_uri: o.redirectUri, state: o.state });
  return `https://discord.com/oauth2/authorize?${q}`;
}

async function json<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => ({}))) as T & { message?: string; retry_after?: number };
  if (!res.ok) throw new DiscordError(body.message ?? `Discord answered ${res.status}`, body.retry_after);
  return body;
}

/** Exchanges the install code; the token response names the server the bot was added to. */
export async function exchangeInstall(
  code: string,
  o: { clientId: string; clientSecret: string; redirectUri: string },
  doFetch: Fetch = fetch,
): Promise<{ guildId: string; guildName: string }> {
  const res = await doFetch(`${API}/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: o.redirectUri, client_id: o.clientId, client_secret: o.clientSecret }),
    signal: AbortSignal.timeout(10_000),
  });
  const body = await json<{ guild?: { id: string; name: string } }>(res);
  if (!body.guild) throw new DiscordError("Discord did not say which server the bot was added to. Try adding it again.");
  return { guildId: body.guild.id, guildName: body.guild.name };
}

/** Channels the bot can post in: text (type 0) and announcement (type 5) channels. */
export async function postableChannels(botToken: string, guildId: string, doFetch: Fetch = fetch): Promise<{ id: string; name: string }[]> {
  const res = await doFetch(`${API}/guilds/${encodeURIComponent(guildId)}/channels`, { headers: { authorization: `Bot ${botToken}` }, signal: AbortSignal.timeout(10_000) });
  const channels = await json<{ id: string; name: string; type: number; position?: number }[]>(res);
  return channels
    .filter((c) => c.type === 0 || c.type === 5)
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    .map((c) => ({ id: c.id, name: c.name }));
}

/**
 * Posts a copy; mentions are switched off so a post can never ping @everyone. Returns the message id, which is how we
 * confirm the copy landed.
 */
export async function sendCopy(
  botToken: string,
  channelId: string,
  post: { text: string; imageUrl?: string | null; link?: string | null },
  doFetch: Fetch = fetch,
): Promise<{ messageId: string }> {
  const text = post.link && !post.text.includes(post.link) ? `${post.text}\n\n${post.link}` : post.text;
  const res = await doFetch(`${API}/channels/${encodeURIComponent(channelId)}/messages`, {
    method: "POST",
    headers: { authorization: `Bot ${botToken}`, "content-type": "application/json" },
    body: JSON.stringify({
      content: fit(text, CONTENT_LIMIT),
      allowed_mentions: { parse: [] },
      ...(post.imageUrl ? { embeds: [{ image: { url: post.imageUrl } }] } : {}),
    }),
    signal: AbortSignal.timeout(10_000),
  });
  const body = await json<{ id: string }>(res);
  return { messageId: body.id };
}

/** A state value that ties the "Add to server" round trip to one user for today (and yesterday, near midnight). */
export function installState(userId: string, secret: string, day: Date): string {
  return createHmac("sha256", secret).update(`qp-discord-install|${userId}|${day.toISOString().slice(0, 10)}`).digest("base64url");
}

/** True when the state came back unchanged for this user, compared in constant time. */
export function stateMatches(state: string, userId: string, secret: string, now: Date): boolean {
  const given = Buffer.from(state);
  return [now, new Date(now.getTime() - 86_400_000)].some((d) => {
    const want = Buffer.from(installState(userId, secret, d));
    return want.length === given.length && timingSafeEqual(want, given);
  });
}

/** The channel to post in by default: one named like "announcements", else the first. */
export function defaultChannel(channels: { id: string; name: string }[]): { id: string; name: string } | null {
  return channels.find((c) => /announce/i.test(c.name)) ?? channels[0] ?? null;
}
