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
  const body = (await res.json().catch(() => null)) as (T & { message?: string; retry_after?: number }) | null;
  // Only Discord's own refusal (a 4xx) means nothing was posted. A 5xx or an answer we cannot read may still have
  // posted, so it is a plain error, which callers treat as "may have been sent".
  if (res.status >= 500 || !body) throw new Error(`Discord answered ${res.status} without a readable result`);
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

/** Channels the bot can post in: text (type 0) and post (type 5) channels. */
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

/** The channel to post in by default: one named like "posts", else the first. */
export function defaultChannel(channels: { id: string; name: string }[]): { id: string; name: string } | null {
  return channels.find((c) => /announce/i.test(c.name)) ?? channels[0] ?? null;
}

const ADMINISTRATOR = BigInt(1 << 3);
const VIEW_CHANNEL = BigInt(1 << 10);
const SEND_MESSAGES = BigInt(1 << 11);
const NONE = BigInt(0);

/** A permission overwrite on a channel: type 0 is a role, type 1 a member. */
export type Overwrite = { id: string; type: number; allow: string; deny: string };

/**
 * Whether a member can see and post in a channel, computed the way Discord documents it
 * (docs.discord.com/developers/topics/permissions, "Permission Overwrites"): @everyone plus the member's roles, then
 * the channel's @everyone overwrite, then its role overwrites together, then the member's own overwrite.
 *
 * @param o.guildId - The server's id, which is also its @everyone role's id
 * @param o.roles - Every role in the server with its permissions
 * @param o.memberRoles - The ids of the roles the member has
 * @param o.memberId - The member's user id
 * @param o.overwrites - The channel's permission overwrites
 * @returns true when the member can view the channel and send messages in it
 */
export function canPost(o: { guildId: string; roles: { id: string; permissions: string }[]; memberRoles: string[]; memberId: string; overwrites: Overwrite[] }): boolean {
  const perm = (id: string) => BigInt(o.roles.find((r) => r.id === id)?.permissions ?? "0");
  let base = perm(o.guildId);
  for (const id of o.memberRoles) base |= perm(id);
  if ((base & ADMINISTRATOR) === ADMINISTRATOR) return true;
  let p = base;
  const everyone = o.overwrites.find((w) => w.id === o.guildId);
  if (everyone) p = (p & ~BigInt(everyone.deny)) | BigInt(everyone.allow);
  let allow = NONE;
  let deny = NONE;
  for (const w of o.overwrites) if (w.type === 0 && w.id !== o.guildId && o.memberRoles.includes(w.id)) { allow |= BigInt(w.allow); deny |= BigInt(w.deny); }
  p = (p & ~deny) | allow;
  const member = o.overwrites.find((w) => w.type === 1 && w.id === o.memberId);
  if (member) p = (p & ~BigInt(member.deny)) | BigInt(member.allow);
  return (p & (VIEW_CHANNEL | SEND_MESSAGES)) === (VIEW_CHANNEL | SEND_MESSAGES);
}

/**
 * The server's text and post channels in server order, each saying whether the bot can post there, so the
 * person picks only a channel that will work.
 */
export async function channelsWithAccess(botToken: string, guildId: string, doFetch: Fetch = fetch): Promise<{ id: string; name: string; canPost: boolean }[]> {
  const get = async <T>(path: string) => json<T>(await doFetch(`${API}${path}`, { headers: { authorization: `Bot ${botToken}` }, signal: AbortSignal.timeout(10_000) }));
  const g = encodeURIComponent(guildId);
  const me = await get<{ id: string }>("/users/@me");
  const [channels, roles, member] = await Promise.all([
    get<{ id: string; name: string; type: number; position?: number; permission_overwrites?: Overwrite[] }[]>(`/guilds/${g}/channels`),
    get<{ id: string; permissions: string }[]>(`/guilds/${g}/roles`),
    get<{ roles: string[] }>(`/guilds/${g}/members/${encodeURIComponent(me.id)}`),
  ]);
  return channels
    .filter((c) => c.type === 0 || c.type === 5)
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    .map((c) => ({ id: c.id, name: c.name, canPost: canPost({ guildId, roles, memberRoles: member.roles, memberId: me.id, overwrites: c.permission_overwrites ?? [] }) }));
}

/**
 * Posts an post exactly as written: no link added, nothing cut. Text over the limit is refused before
 * anything is sent, so the preview is always what lands. Mentions stay off, so it never pings @everyone.
 */
export async function postText(botToken: string, channelId: string, content: string, doFetch: Fetch = fetch): Promise<{ messageId: string }> {
  if (content.length > CONTENT_LIMIT) throw new DiscordError(`Discord takes up to ${CONTENT_LIMIT} characters; this is ${content.length}.`);
  const res = await doFetch(`${API}/channels/${encodeURIComponent(channelId)}/messages`, {
    method: "POST",
    headers: { authorization: `Bot ${botToken}`, "content-type": "application/json" },
    body: JSON.stringify({ content, allowed_mentions: { parse: [] } }),
    signal: AbortSignal.timeout(10_000),
  });
  const id = (await json<{ id?: string }>(res)).id;
  if (!id) throw new Error("Discord accepted the message but did not return its id");
  return { messageId: id };
}

/** The link that opens a posted message in Discord. */
export function messageUrl(guildId: string, channelId: string, messageId: string): string {
  return `https://discord.com/channels/${guildId}/${channelId}/${messageId}`;
}
