import "server-only";
/**
 * The real senders for direct posts and the due run every host calls: the Docker check every 30 seconds, the daily
 * job as a safety net, and on Vercel a timer per post. Telegram and Discord errors are refusals; anything else may
 * have landed.
 */
import * as telegram from "./telegram";
import * as discord from "./discord";
import { botTokens } from "./echo-run";
import { postgresEchoStore } from "./echo-store";
import { postgresDirectPostStore } from "./direct-post-store";
import { runDue, type DirectPostDeps } from "./direct-posts";

type Tokens = { telegram?: string; discord?: string };

/**
 * The place a post was written for is no longer connected (disconnected, or replaced by another channel or server).
 * Nothing is posted; the person sees the reason.
 */
export class DestinationGone extends Error {}

/**
 * Senders backed by the deployment's bots. A Discord message link needs the person's server, read once per person.
 *
 * @param tokens - The Telegram and Discord bot tokens in use
 */
export function directPostDeps(tokens: Tokens): DirectPostDeps {
  const current = new Map<string, Promise<{ telegram?: string; discordGuild?: string | null }>>();
  const connected = (userId: string) => {
    let c = current.get(userId);
    if (!c) {
      c = postgresEchoStore().destinations(userId).then((ds) => ({
        telegram: ds.find((d) => d.kind === "telegram")?.target,
        discordGuild: ds.find((d) => d.kind === "discord")?.guildId,
      }));
      current.set(userId, c);
    }
    return c;
  };
  return {
    store: postgresDirectPostStore(),
    refused: (e) => e instanceof telegram.TelegramError || e instanceof discord.DiscordError || e instanceof DestinationGone,
    post: async (item, userId) => {
      // Send only to the place the post was written for: the same Telegram channel, the same Discord server.
      const now = await connected(userId);
      if (item.kind === "telegram") {
        if (now.telegram !== item.target) throw new DestinationGone("This Telegram channel was disconnected from Queue Pilot before the post went out, so it was not sent.");
        if (!tokens.telegram) throw new telegram.TelegramError("Queue Pilot's Telegram bot is not set up on this deployment.");
        const r = await telegram.postText(tokens.telegram, Number(item.target), item.text);
        return { link: telegram.messageUrl(r.username, r.messageId) };
      }
      if (!now.discordGuild || (item.guildId && now.discordGuild !== item.guildId)) {
        throw new DestinationGone("This Discord server was disconnected from Queue Pilot before the post went out, so it was not sent.");
      }
      if (!tokens.discord) throw new discord.DiscordError("Queue Pilot's Discord bot is not set up on this deployment.");
      const r = await discord.postText(tokens.discord, item.target, item.text);
      const guildId = item.guildId ?? now.discordGuild;
      return { link: discord.messageUrl(guildId, item.target, r.messageId) };
    },
  };
}

/**
 * Sends every direct post that is due, or just one post at one revision. Logs one line per destination it handled.
 *
 * @returns How many destinations were handled, and how many of those were sent
 */
export async function runDueDirectPosts(only?: { postId: string; revision: number }): Promise<{ handled: number; sent: number }> {
  const results = await runDue(directPostDeps(await botTokens()), { limit: 25, only });
  for (const r of results) console.log(JSON.stringify({ event: "qp-direct-post", postId: r.postId, kind: r.kind, status: r.status }));
  return { handled: results.length, sent: results.filter((r) => r.status === "sent").length };
}
