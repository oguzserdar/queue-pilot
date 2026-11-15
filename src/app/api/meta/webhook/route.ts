/**
 * Where Meta sends Instagram comments and messages for the accounts people connected. Meta wants a 200 within five
 * seconds and turns the webhook off after an hour of failures, so this route only checks, stores and queues: the
 * signature is checked on the raw body before anything else (a bad one is 401 with no database work), each event for
 * an account with replies on is stored once, and a reply is queued for the replies run to draft, judge and send.
 *
 * Dropped without storing: accounts with replies off, events from before replies were turned on, and the account's own
 * comments and messages (src/lib/meta-webhook.ts). A comment gets a private reply (Meta: one message per commenter,
 * within 7 days); a direct message gets a reply in the conversation.
 */
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { socialAccount } from "@/db/schema";
import { operatorSetting } from "@/lib/env";
import { challengeFor, parseInstagramEvents, signatureValid } from "@/lib/meta-webhook";
import { postgresReplyStore } from "@/lib/reply-store";

/**
 * False until an Instagram sender is wired into the replies run. Until then events are stored (they show in the inbox)
 * but no reply is queued, because a queued reply nothing can send would sit undecided until it aged out.
 */
const INSTAGRAM_SENDER_READY = false;

export async function GET(req: Request) {
  const token = (await operatorSetting("meta_webhook_verify_token")) ?? "";
  const challenge = challengeFor(new URL(req.url).searchParams, token);
  return challenge ? new Response(challenge, { status: 200, headers: { "content-type": "text/plain" } }) : new Response(null, { status: 403 });
}

export async function POST(req: Request) {
  const raw = await req.text();
  const secret = (await operatorSetting("meta_app_secret")) ?? "";
  if (!signatureValid(raw, req.headers.get("x-hub-signature-256"), secret)) return new Response(null, { status: 401 });
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return new Response(null, { status: 200 });
  }
  const store = postgresReplyStore();
  const now = new Date();
  for (const ev of parseInstagramEvents(body)) {
    // Only one person can have replies on for an account (a unique index), so this finds at most one.
    const [account] = await db().select({ id: socialAccount.id, userId: socialAccount.userId, since: socialAccount.repliesSince, broken: socialAccount.brokenAt })
      .from(socialAccount).where(and(eq(socialAccount.network, "instagram"), eq(socialAccount.accountId, ev.accountId), eq(socialAccount.repliesOn, true))).limit(1);
    if (!account || account.broken || !account.since || ev.at < account.since) continue;
    const recorded = await store.recordInbound({
      userId: account.userId, channel: "instagram", channelInstance: account.id, from: { value: ev.from.id, displayName: ev.from.username },
      threadKey: ev.kind === "comment" ? (ev.postId ?? ev.externalId) : ev.from.id, externalId: ev.externalId, kind: ev.kind, text: ev.text, at: ev.at,
      postExternalId: ev.postId, meta: { from: ev.from.id },
    });
    if (INSTAGRAM_SENDER_READY) await store.queueReply(account.userId, recorded.messageId, ev.kind === "comment" ? "private" : "dm", now);
  }
  return new Response(null, { status: 200 });
}
