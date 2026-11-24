import "server-only";
/**
 * The real senders for direct posts and the due run every host calls: the Docker check every 30 seconds, the daily
 * job as a safety net, and on Vercel a timer per post. Telegram and Discord errors are refusals; anything else after
 * the call started may have landed.
 */
import * as telegram from "./telegram";
import * as discord from "./discord";
import * as mastodon from "./mastodon";
import * as bluesky from "./bluesky";
import { markAccountBroken, readSocialAccount } from "./social-accounts";
import { blueskySession, withBlueskySession } from "./bluesky-session";
import { createHash } from "node:crypto";
import { botTokens } from "./echo-run";
import { postgresEchoStore } from "./echo-store";
import { postgresDirectPostStore } from "./direct-post-store";
import { postgresCooldowns } from "./cooldowns";
import { forLog, retimeFollowUps, runDue, type BufferState, type DirectPostDeps, type PostItem, type PostKind } from "./direct-posts";
import type { Post } from "./buffer/queries";
import { getAuth } from "./auth";
import { bufferAccessToken } from "./buffer-token";
import { readPostsNow } from "./buffer/queries";
import { withBudget } from "./buffer/budget";

type Tokens = { telegram?: string; discord?: string };

/**
 * The place a post was written for is no longer connected (disconnected, or replaced by another channel or server).
 * Nothing is posted; the person sees the reason.
 */
export class DestinationGone extends Error {}

/**
 * Reads a person's followed Buffer posts with their own Buffer sign-in: one request for all of them, counted against
 * the person's Buffer allowance like every background read. Published means Buffer sent it (a reminder post counts
 * only once the person marked it published). Throws when Buffer cannot be read; the due run waits and tries again.
 *
 * @returns Each id's state; an id Buffer no longer has reads as deleted
 */
export async function readBufferStates(userId: string, bufferPostIds: string[]): Promise<Map<string, BufferState>> {
  const auth = await getAuth();
  if (!auth) throw new Error("Buffer sign-in is not set up on this deployment.");
  const token = await bufferAccessToken(auth, userId);
  const { result: posts } = await withBudget("follow-up-check", userId, () => readPostsNow(token, bufferPostIds));
  const byId = new Map(posts.map((p) => [p.id, p]));
  return new Map(bufferPostIds.map((id) => [id, stateOf(byId.get(id))]));
}

function stateOf(post: Post | undefined): BufferState {
  if (!post) return { state: "gone", reason: "The post was deleted in Buffer, so this was not sent." };
  if (post.status === "sent") {
    if (post.schedulingType === "notification" && post.notificationStatus !== "markedAsPublished") return { state: "waiting", dueAt: post.dueAt ? new Date(post.dueAt) : null };
    return { state: "sent" };
  }
  if (post.status === "error") return { state: "gone", reason: `Buffer could not publish the post${post.error?.message ? `: ${post.error.message}` : ""}. This was not sent.` };
  if (post.status === "draft") return { state: "gone", reason: "The post went back to drafts in Buffer, so this was not sent." };
  return { state: "waiting", dueAt: post.dueAt ? new Date(post.dueAt) : null };
}

/**
 * Senders backed by the deployment's bots. Before any call, `ready` checks the post goes to the place it was written
 * for (the same Telegram channel, the same Discord server) and that the bot is set up; the bot tokens are read only
 * when something is actually sent.
 *
 * @param tokens - Reads the Telegram and Discord bot tokens in use, once
 */
export function directPostDeps(tokens: () => Promise<Tokens>): DirectPostDeps {
  let tokenRead: Promise<Tokens> | undefined;
  const bots = () => (tokenRead ??= tokens());
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
  const context: SendContext = { bots, connected };
  return {
    store: postgresDirectPostStore(),
    cooldowns: postgresCooldowns(),
    bufferCheck: readBufferStates,
    refused: (e) => e instanceof DestinationGone || SENDER_LIST.some((s) => s.refused(e)),
    ready: (item, userId) => SENDERS[item.kind].ready(item, userId, context),
    post: (item, userId, ref) => SENDERS[item.kind].post(item, userId, context, ref),
  };
}

/** What every sender may read: the deployment's bot tokens and the places this person has connected, each read once per run. */
type SendContext = {
  bots: () => Promise<Tokens>;
  connected: (userId: string) => Promise<{ telegram?: string; discordGuild?: string | null }>;
};

/**
 * One network's part of a send: `ready` checks before any call that the post still goes to the place it was written
 * for and that the network is set up (throwing a refusal or DestinationGone); `post` sends the exact text and returns a
 * link; `refused` says an error is the network's own refusal, so nothing was posted.
 */
type Sender = {
  ready: (item: PostItem, userId: string, ctx: SendContext) => Promise<void>;
  post: (item: PostItem, userId: string, ctx: SendContext, ref: { postId: string; createdAt: Date }) => Promise<{ link: string | null }>;
  refused: (e: unknown) => boolean;
};

/** Every network the engine posts to directly, one entry each; a new network is a new entry here. */
const SENDERS: Record<PostKind, Sender> = {
  telegram: {
    ready: async (item, userId, ctx) => {
      const [now, t] = await Promise.all([ctx.connected(userId), ctx.bots()]);
      if (now.telegram !== item.target) throw new DestinationGone("This Telegram channel was disconnected from Queue Pilot before the post went out, so it was not sent.");
      if (!t.telegram) throw new telegram.TelegramError("Queue Pilot's Telegram bot is not set up on this deployment.");
    },
    post: async (item, _userId, ctx) => {
      const t = await ctx.bots();
      if (!t.telegram) throw new telegram.TelegramError("Queue Pilot's Telegram bot is not set up on this deployment.");
      const r = await telegram.postText(t.telegram, Number(item.target), item.text);
      return { link: telegram.messageUrl(r.username, r.messageId) };
    },
    refused: (e) => e instanceof telegram.TelegramError,
  },
  discord: {
    ready: async (item, userId, ctx) => {
      const [now, t] = await Promise.all([ctx.connected(userId), ctx.bots()]);
      // A row with no server recorded was written before servers were; it cannot prove it is still the same server.
      if (!item.guildId) throw new DestinationGone("This post was written before Queue Pilot recorded the Discord server, so it was not sent again. Write it again.");
      if (now.discordGuild !== item.guildId) throw new DestinationGone("This Discord server was disconnected from Queue Pilot before the post went out, so it was not sent.");
      if (!t.discord) throw new discord.DiscordError("Queue Pilot's Discord bot is not set up on this deployment.");
    },
    post: async (item, _userId, ctx) => {
      const t = await ctx.bots();
      if (!item.guildId) throw new DestinationGone("This post was written before Queue Pilot recorded the Discord server, so it was not sent again. Write it again.");
      if (!t.discord) throw new discord.DiscordError("Queue Pilot's Discord bot is not set up on this deployment.");
      const r = await discord.postText(t.discord, item.target, item.text);
      return { link: discord.messageUrl(item.guildId, item.target, r.messageId) };
    },
    refused: (e) => e instanceof discord.DiscordError,
  },
  mastodon: {
    // The target is the person's connected account; it must still be theirs, connected and not refused before.
    ready: async (item, userId) => {
      const account = await readSocialAccount(userId, item.target);
      if (!account || account.network !== "mastodon") throw new DestinationGone("This Mastodon account was disconnected from Queue Pilot before the post went out, so it was not sent.");
      if (account.broken) throw new mastodon.MastodonError("Mastodon refused this account's sign-in earlier. Connect the account again.", 401);
    },
    post: async (item, userId, _ctx, ref) => {
      const account = await readSocialAccount(userId, item.target);
      if (!account) throw new DestinationGone("This Mastodon account was disconnected from Queue Pilot before the post went out, so it was not sent.");
      try {
        // Stable per destination and text: a repeat within Mastodon's hour posts nothing new, and an edited text is
        // never answered with the old status (Mastodon returns the first status for a reused key, ignoring the body).
        const r = await mastodon.postStatus(account.server, account.credentials.token ?? "", item.text, `${ref.postId}:${item.target}:${textHash(item.text)}`);
        return { link: r.link };
      } catch (e) {
        if (e instanceof mastodon.MastodonError && (e.status === 401 || e.status === 403)) await markAccountBroken(userId, item.target).catch(() => {});
        throw e;
      }
    },
    refused: (e) => e instanceof mastodon.MastodonError,
  },
  bluesky: {
    // The session is made sure of here, before the call is marked started: a sign-in that fails cannot have posted.
    ready: async (item, userId) => {
      const account = await readSocialAccount(userId, item.target);
      if (!account || account.network !== "bluesky") throw new DestinationGone("This Bluesky account was disconnected from Queue Pilot before the post went out, so it was not sent.");
      if (account.broken) throw new bluesky.BlueskyError("Bluesky refused this account's sign-in earlier. Connect the account again.", 401);
      try {
        await blueskySession(userId, account);
      } catch (e) {
        if (e instanceof bluesky.BlueskyError && (e.status === 401 || e.status === 403)) {
          await markAccountBroken(userId, item.target).catch(() => {});
          throw e;
        }
        // A "wait" at sign-in goes through as it is: the run holds the account until then (cooldowns).
        if (e instanceof bluesky.BlueskyError && e.status === 429) throw e;
        // No answer at sign-in is not a refusal of the post: the row stays claimed and is tried again.
        throw new Error(`Bluesky sign-in did not complete: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
    post: async (item, userId, _ctx, ref) => {
      const account = await readSocialAccount(userId, item.target);
      if (!account) throw new DestinationGone("This Bluesky account was disconnected from Queue Pilot before the post went out, so it was not sent.");
      // True only while the post call itself is open: a failure outside it (renewing an expired session) posted nothing.
      let inCall = false;
      try {
        // A record key fixed for this destination of this post: a second create on it is refused, never a duplicate.
        const rkey = bluesky.tidFor(`${ref.postId}:${item.target}`, ref.createdAt);
        const r = await withBlueskySession(userId, account, async (session) => {
          inCall = true;
          try {
            return await bluesky.postText(account.server, session, item.text, rkey);
          } catch (e) {
            if (e instanceof bluesky.BlueskyError) inCall = false;
            throw e;
          }
        });
        return { link: r.link };
      } catch (e) {
        if (e instanceof bluesky.BlueskyError && (e.status === 401 || e.status === 403)) await markAccountBroken(userId, item.target).catch(() => {});
        if (!inCall && !(e instanceof bluesky.BlueskyError)) throw new bluesky.BlueskyError(`Bluesky's session could not be renewed, so nothing was posted: ${e instanceof Error ? e.message : String(e)}`, 503);
        throw e;
      }
    },
    refused: (e) => e instanceof bluesky.BlueskyError,
  },
};
const SENDER_LIST = Object.values(SENDERS);

/** A short hash of a post's text, for keys that must change when the text does. */
const textHash = (text: string) => createHash("sha256").update(text).digest("hex").slice(0, 16);

/**
 * Starts the Vercel timer for a scheduled post. Elsewhere (Docker) the 30-second check sends it, so there is nothing
 * to start.
 */
export async function startTimer(postId: string, revision: number, sendAt: Date): Promise<void> {
  if (!process.env.VERCEL) return;
  const [{ start }, { directPostTimer }] = await Promise.all([import("workflow/api"), import("@/workflows/direct-post-timer")]);
  await start(directPostTimer, [postId, revision, sendAt.toISOString()]);
}

/** Logs a timer that did not start; the 30-second check and the daily job still send the post. */
export function timerFailed(postId: string, revision: number, e: unknown): void {
  console.error(JSON.stringify({ event: "qp-direct-post-timer-failed", postId, revision, message: forLog(e) }));
}

/** Starts a post's timer; when it does not start, logs it and returns the note telling the person it may be late. */
export async function startTimerOrNote(postId: string, revision: number, at: Date): Promise<string | undefined> {
  try {
    await startTimer(postId, revision, at);
    return undefined;
  } catch (e) {
    timerFailed(postId, revision, e);
    return "Saved, but its timer did not start, so it may go out late, with the daily check.";
  }
}

/**
 * Re-times follow-ups whose Buffer post moved, after fresh Buffer data was read: each waits for the post's new time
 * plus a minute, with a new timer. Logs and carries on if a timer cannot start.
 */
export async function retimeFollowUpsFor(userId: string, posts: Post[]): Promise<number> {
  const moved = await retimeFollowUps(userId, posts, postgresDirectPostStore(), new Date());
  for (const m of moved) await startTimerOrNote(m.postId, m.revision, m.sendAt);
  return moved.length;
}

/**
 * Sends every direct post that is due, or just one post at one revision. Logs one line per destination it handled.
 *
 * @param opts.limit - Rows per run (the daily safety net runs again while a run fills it)
 * @param opts.tokens - The bot tokens, when the caller already read them
 * @returns How many destinations were handled and sent, and the soonest time a waiting row asked to be looked at again
 */
/** How long one run of due posts may keep starting sends (the cron route allows 60 seconds). */
export const RUN_BUDGET_MS = 20_000;

export async function runDueDirectPosts(only?: { postId: string; revision: number }, opts: { limit?: number; tokens?: () => Promise<Tokens> } = {}): Promise<{ handled: number; sent: number; next: string | null }> {
  // The route may run 60 seconds. One send can make two slow calls (Bluesky renews an expired session, then posts;
  // each call may take 20 seconds), so no send starts after 20.
  const results = await runDue(directPostDeps(opts.tokens ?? (() => botTokens())), { limit: opts.limit ?? 25, only, deadline: new Date(Date.now() + RUN_BUDGET_MS) });
  for (const r of results) {
    console.log(JSON.stringify({ event: "qp-direct-post", userId: r.userId, postId: r.postId, kind: r.kind, status: r.status, error: r.error, next: r.next?.toISOString() }));
  }
  const nexts = results.flatMap((r) => (r.next ? [r.next.getTime()] : []));
  return { handled: results.length, sent: results.filter((r) => r.status === "sent").length, next: nexts.length ? new Date(Math.min(...nexts)).toISOString() : null };
}
