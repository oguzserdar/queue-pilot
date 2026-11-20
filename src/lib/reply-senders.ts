/**
 * @fileoverview The reply call for each network the replies run answers on. Each sender gets a narrow context (the
 * account, the clock, the HTTP post call, marking the account broken and the reply rows), never the whole run, so a
 * sender cannot reach the run's other state. Every network that answers needs an entry in SENDERS, or the type check
 * fails: a new network can never fall through to another network's sender.
 */
import "server-only";
import * as z from "zod";
import * as mastodon from "./mastodon";
import * as bluesky from "./bluesky";
import { withBlueskySession } from "./bluesky-session";
import type { SendRequest } from "./replies";
import type { ReplyStore } from "./reply-store";
import { withMention } from "./reply-mentions";
import type { ReplyAccount } from "./social-accounts";
import type { ReplyNetwork } from "./social-networks";
import { ReplyRefused, RenewFailed, signInRefused } from "./reply-errors";
import * as instagram from "./instagram";
import { safePost } from "./safe-fetch";

/** What a sender may use: the account, the clock, the HTTP post call, marking the account broken, the reply rows. */
export type SendContext = {
  account: ReplyAccount;
  now: () => Date;
  post: Parameters<typeof mastodon.replyTo>[6];
  markBroken: (userId: string, accountId: string) => Promise<unknown>;
  replies: ReplyStore["replies"];
};

/** A thread root kept with a Bluesky mention: its address and content hash. */
const KeptRoot = z.looseObject({ uri: z.string(), cid: z.string() });

/** The reply call for one network. */
export type Sender = (req: SendRequest) => Promise<{ externalId: string | null }>;
/** The route a reply goes out on: a public reply, a private reply to a comment, or a message in a conversation. */
export type ReplyRoute = "public" | "private" | "dm";
export type MakeSender = (ctx: SendContext, inboundId: string, route: ReplyRoute, externalId: string, meta: Record<string, unknown> | null) => Sender;

/** Marks the account broken when the network refused its sign-in, so the person reconnects. */
const markBrokenOn = (ctx: SendContext) => async (e: unknown) => { if (signInRefused(e)) await ctx.markBroken(ctx.account.userId, ctx.account.id).catch(() => {}); };

/** A Mastodon reply: must start with the author's @, never more public than what it answers. */
const mastodonSender: MakeSender = (ctx, _inboundId, _route, externalId, meta) => {
  const { account, now } = ctx;
  const broken = markBrokenOn(ctx);
  {
    const acct = typeof meta?.acct === "string" ? meta.acct : null;
    // A visibility not kept is answered as direct: never more public than what it answers.
    const visibility = (["public", "unlisted", "private", "direct"] as const).find((v) => v === meta?.visibility) ?? "direct";
    return async (req) => {
      if (!acct) throw new ReplyRefused("The mention's author was not kept, so nothing was sent.");
      if (withMention(req.text, acct) !== req.text) throw new ReplyRefused(`A Mastodon reply must start with @${acct}.`);
      try {
        const { id } = await mastodon.replyTo(account.server, account.credentials.token ?? "", externalId, req.text, req.key, visibility, ctx.post, now);
        return { externalId: id };
      } catch (e) { await broken(e); throw e; }
    };
  }
};

/** A Bluesky reply: threaded under the mention, with a record key that never changes for this reply. */
const blueskySender: MakeSender = (ctx, inboundId, _route, externalId, meta) => {
  const { account, now } = ctx;
  const broken = markBrokenOn(ctx);
  const cid = typeof meta?.cid === "string" ? meta.cid : null;
  const keptRoot = KeptRoot.safeParse(meta?.root);
  const root = keptRoot.success ? keptRoot.data : null;
  return async (req) => {
    if (!cid) throw new ReplyRefused("The mention's content id was not kept, so nothing was sent.");
    const self = { uri: externalId, cid };
    // The record key comes from the reply row's id and its fixed creation time, so it never changes for this reply.
    const row = (await ctx.replies(account.userId, inboundId)).find((x) => x.id === req.key);
    if (!row) throw new ReplyRefused("The reply's row was not found, so nothing was sent.");
    // The last error the reply call itself gave. Any other error came from renewing the session, before a call.
    let fromCall: unknown;
    try {
      const { uri } = await withBlueskySession(account.userId, account, async (session) => {
        try {
          return await bluesky.replyTo(account.server, session, self, root ?? self, req.text, bluesky.tidFor(req.key, row.at), ctx.post, now);
        } catch (e) {
          fromCall = e;
          throw e;
        }
      }, { post: ctx.post });
      return { externalId: uri };
    } catch (e) {
      await broken(e);
      // Renewing failed before any call, so nothing was posted: the reply waits and is tried again. A refused sign-in
      // (the account is broken) and a rate limit (with its own wait) keep their own handling.
      const rateLimited = e instanceof bluesky.BlueskyError && e.status === 429;
      if (e !== fromCall && !signInRefused(e) && !rateLimited) throw new RenewFailed(e);
      throw e;
    }
  };
}

/**
 * An Instagram reply: a comment gets a private reply (recipient.comment_id), a message gets a reply in its conversation
 * (recipient.id, the sender the webhook kept). Sent at most once; a refusal says whether to wait, reconnect or stop.
 */
const instagramSender: MakeSender = (ctx, _inboundId, route, externalId, meta) => {
  const { account } = ctx;
  const broken = markBrokenOn(ctx);
  const from = typeof meta?.from === "string" ? meta.from : null;
  return async (req) => {
    const problem = instagram.textProblem(req.text);
    if (problem) throw new ReplyRefused(problem);
    if (route === "public") throw new ReplyRefused("Instagram comments are answered privately, never publicly, so nothing was sent.");
    if (route === "dm" && !from) throw new ReplyRefused("The message's sender was not kept, so nothing was sent.");
    const to: instagram.ReplyTarget = route === "private" ? { commentId: externalId } : { userId: from ?? "" };
    try {
      const { messageId } = await instagram.sendReply(account.networkAccountId, account.credentials.token ?? "", to, req.text, ctx.post ?? safePost);
      return { externalId: messageId };
    } catch (e) { await broken(e); throw e; }
  };
};

/** The reply call for each network. Every network that answers needs an entry, or the type check fails. */
export const SENDERS: Record<ReplyNetwork, MakeSender> = { mastodon: mastodonSender, bluesky: blueskySender, instagram: instagramSender };
