import "server-only";
/**
 * The real senders for direct posts and the due run every host calls: the Docker check every 30 seconds, the daily
 * job as a safety net, and on Vercel a timer per post. Telegram and Discord errors are refusals; anything else after
 * the call started may have landed.
 */
import * as telegram from "./telegram";
import * as discord from "./discord";
import { botTokens } from "./echo-run";
import { postgresEchoStore } from "./echo-store";
import { postgresDirectPostStore } from "./direct-post-store";
import { retimeFollowUps, runDue, type BufferState, type DirectPostDeps } from "./direct-posts";
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
 * Reads one Buffer post with the person's own Buffer sign-in: one request, only that post, counted against the
 * person's Buffer allowance like every background read. Published means Buffer sent it (a reminder post counts only
 * once the person marked it published). Throws when Buffer cannot be read; the due run waits and tries again.
 */
export async function readBufferState(userId: string, bufferPostId: string): Promise<BufferState> {
  const auth = await getAuth();
  if (!auth) throw new Error("Buffer sign-in is not set up on this deployment.");
  const token = await bufferAccessToken(auth, userId);
  const { result: [post] } = await withBudget("follow-up-check", userId, () => readPostsNow(token, [bufferPostId]));
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
  return {
    store: postgresDirectPostStore(),
    bufferCheck: readBufferState,
    refused: (e) => e instanceof telegram.TelegramError || e instanceof discord.DiscordError || e instanceof DestinationGone,
    ready: async (item, userId) => {
      const [now, t] = await Promise.all([connected(userId), bots()]);
      if (item.kind === "telegram") {
        if (now.telegram !== item.target) throw new DestinationGone("This Telegram channel was disconnected from Queue Pilot before the post went out, so it was not sent.");
        if (!t.telegram) throw new telegram.TelegramError("Queue Pilot's Telegram bot is not set up on this deployment.");
        return;
      }
      // A row with no server recorded was written before servers were; it cannot prove it is still the same server.
      if (!item.guildId) throw new DestinationGone("This post was written before Queue Pilot recorded the Discord server, so it was not sent again. Write it again.");
      if (now.discordGuild !== item.guildId) throw new DestinationGone("This Discord server was disconnected from Queue Pilot before the post went out, so it was not sent.");
      if (!t.discord) throw new discord.DiscordError("Queue Pilot's Discord bot is not set up on this deployment.");
    },
    post: async (item) => {
      const t = await bots();
      if (item.kind === "telegram") {
        const r = await telegram.postText(t.telegram!, Number(item.target), item.text);
        return { link: telegram.messageUrl(r.username, r.messageId) };
      }
      const r = await discord.postText(t.discord!, item.target, item.text);
      return { link: discord.messageUrl(item.guildId!, item.target, r.messageId) };
    },
  };
}

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
  console.error(JSON.stringify({ event: "qp-direct-post-timer-failed", postId, revision, message: e instanceof Error ? e.message : String(e) }));
}

/**
 * Re-times follow-ups whose Buffer post moved, after fresh Buffer data was read: each waits for the post's new time
 * plus a minute, with a new timer. Logs and carries on if a timer cannot start.
 */
export async function retimeFollowUpsFor(userId: string, posts: Post[]): Promise<number> {
  const moved = await retimeFollowUps(userId, posts, postgresDirectPostStore(), new Date());
  for (const m of moved) await startTimer(m.postId, m.revision, m.sendAt).catch((e) => timerFailed(m.postId, m.revision, e));
  return moved.length;
}

/**
 * Sends every direct post that is due, or just one post at one revision. Logs one line per destination it handled.
 *
 * @param opts.limit - Rows per run (the daily safety net runs again while a run fills it)
 * @returns How many destinations were handled and sent, and the soonest time a waiting row asked to be looked at again
 */
export async function runDueDirectPosts(only?: { postId: string; revision: number }, opts: { limit?: number } = {}): Promise<{ handled: number; sent: number; next: string | null }> {
  const results = await runDue(directPostDeps(() => botTokens()), { limit: opts.limit ?? 25, only });
  for (const r of results) {
    console.log(JSON.stringify({ event: "qp-direct-post", userId: r.userId, postId: r.postId, kind: r.kind, status: r.status, error: r.error, next: r.next?.toISOString() }));
  }
  const nexts = results.flatMap((r) => (r.next ? [r.next.getTime()] : []));
  return { handled: results.length, sent: results.filter((r) => r.status === "sent").length, next: nexts.length ? new Date(Math.min(...nexts)).toISOString() : null };
}
