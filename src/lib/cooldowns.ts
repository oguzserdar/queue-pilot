/**
 * @fileoverview Waits shared by every post to one place. When a network answers "wait", the place it counts the limit
 * by is cooled until then, so other posts to it make no call and are not counted as waits of
 * their own. Keys: the network identity for Mastodon and Bluesky (the same account connected twice is one limit),
 * the channel for Discord, the chat for Telegram.
 */
import { and, eq, gt, sql } from "drizzle-orm";
import { db } from "../db";
import { cooldown } from "../db/schema";
import type { Cooldowns, PostItem } from "./direct-posts";
import { readSocialAccount, repliesOwnerKey } from "./social-accounts";
import { DiscordError } from "./discord";

/** The key for a wait that covers Queue Pilot's whole Discord bot. */
export const DISCORD_BOT = "discord bot";

/** The key a place's limit is counted by, or null when the account is gone (its send then fails on its own). */
export async function cooldownKey(item: PostItem, userId: string): Promise<string | null> {
  if (item.kind === "telegram") return `telegram chat ${item.target}`;
  if (item.kind === "discord") return `discord channel ${item.target}`;
  const account = await readSocialAccount(userId, item.target);
  return account ? repliesOwnerKey({ network: account.network, server: account.server, accountId: account.networkAccountId }) : null;
}

/** Cooldowns in Postgres. A shorter wait never shortens a longer one (greatest). */
export function postgresCooldowns(): Cooldowns {
  return {
    key: cooldownKey,
    // Discord: every channel also checks the bot-wide key; a refusal marked global is noted there instead.
    wider: (key, e) => (key.startsWith("discord ") && (e === undefined || (e instanceof DiscordError && e.global)) ? DISCORD_BOT : null),
    async active(key, now) {
      const [row] = await db().select({ until: cooldown.until }).from(cooldown).where(and(eq(cooldown.key, key), gt(cooldown.until, now))).limit(1);
      return row?.until ?? null;
    },
    async note(key, until) {
      await db().insert(cooldown).values({ key, until }).onConflictDoUpdate({ target: cooldown.key, set: { until: sql`greatest(${cooldown.until}, excluded.until)` } });
    },
  };
}
