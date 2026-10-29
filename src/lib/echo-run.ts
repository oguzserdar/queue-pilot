import "server-only";
/**
 * Runs the echo for one user after their Buffer posts are read: plans the copies, sends them with the shared bots,
 * records each one. A destination whose bot token is not configured is skipped quietly (nothing to send with yet).
 */
import { after } from "next/server";
import type { Post } from "./buffer/queries";
import { imageOf, planEchoes, runEchoes, type EchoRecord, type EchoSend } from "./echo";
import { CLAIM_MS, postgresEchoStore, type EchoStore } from "./echo-store";
import * as telegram from "./telegram";
import * as discord from "./discord";

export type BotTokens = { telegram?: string; discord?: string };

/** The bot tokens from the environment; empty strings count as missing. */
export function botTokensFromEnv(env: NodeJS.ProcessEnv = process.env): BotTokens {
  return { telegram: env.TELEGRAM_BOT_TOKEN || undefined, discord: env.DISCORD_BOT_TOKEN || undefined };
}

type CopyBody = { text: string; link?: string | null; imageUrl?: string | null };

export type Senders = {
  telegram: (token: string, chatId: number, post: CopyBody) => Promise<{ messageId: number }>;
  discord: (token: string, channelId: string, post: CopyBody) => Promise<{ messageId: string }>;
};

const realSenders: Senders = {
  telegram: (token, chatId, post) => telegram.sendCopy(token, chatId, post),
  discord: (token, channelId, post) => discord.sendCopy(token, channelId, post),
};

/** Copies this user's newly sent posts to their destinations. Returns what was attempted. */
export async function echoForUser(userId: string, posts: Post[], deps: { store: EchoStore; tokens: BotTokens; now?: Date; senders?: Senders }): Promise<EchoRecord[]> {
  const senders = deps.senders ?? realSenders;
  const all = await deps.store.destinations(userId);
  const usable = all.filter((d) => (d.kind === "telegram" ? deps.tokens.telegram : deps.tokens.discord));
  if (usable.length === 0) return [];

  const sentIds = posts.filter((p) => p.status === "sent").map((p) => p.id);
  const records = await deps.store.records(userId, sentIds);
  const connectedAt = Object.fromEntries(usable.map((d) => [d.id, new Date(d.connectedAt)]));
  const plan = planEchoes(posts, usable, records, deps.now ?? new Date(), connectedAt);
  if (plan.length === 0) return [];

  const byId = new Map(usable.map((d) => [d.id, d]));
  const previous = new Map(records.map((r) => [`${r.postId}|${r.destinationId}`, r]));
  const now = deps.now ?? new Date();
  return runEchoes(plan, {
    claim: (postId, destinationId) => deps.store.claim(userId, postId, destinationId, now, new Date(now.getTime() + CLAIM_MS)),
    send: async ({ post, destination }: EchoSend) => {
      const d = byId.get(destination.id)!;
      const body = { text: post.text, link: post.externalLink, imageUrl: imageOf(post) };
      if (d.kind === "telegram") return { messageId: String((await senders.telegram(deps.tokens.telegram!, Number(d.target), body)).messageId) };
      return senders.discord(deps.tokens.discord!, d.target, body);
    },
    record: (r) => deps.store.record(userId, r),
    previous: (postId, destinationId) => previous.get(`${postId}|${destinationId}`),
  });
}

/**
 * After fresh Buffer data is read (the sync button, auto-sync, or the AI's connector), copy newly sent posts once the
 * response has gone out, so the echo never slows a page. Does nothing until at least one bot token is configured.
 */
export function scheduleEcho(userId: string, posts: Post[]): void {
  const tokens = botTokensFromEnv();
  if (!tokens.telegram && !tokens.discord) return;
  after(async () => {
    try {
      const out = await echoForUser(userId, posts, { store: postgresEchoStore(), tokens });
      for (const r of out.filter((x) => x.status === "failed")) console.warn(JSON.stringify({ event: "qp-echo-failed", postId: r.postId, attempts: r.attempts, error: r.error }));
    } catch (e) {
      console.error(JSON.stringify({ event: "qp-echo-run-failed", message: e instanceof Error ? e.message : String(e) }));
    }
  });
}
