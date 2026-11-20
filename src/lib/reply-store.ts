/**
 * Replies in Postgres: contacts, conversations, messages, the reply-once claim and opt-outs (src/db/schema.ts).
 * Every statement is scoped to the workspace's user id. Exclusivity always comes from one statement: an insert that
 * does nothing on conflict, or a conditional update, so two workers can never both win a claim.
 */
import { randomUUID } from "node:crypto";
import { alias } from "drizzle-orm/pg-core";
import { and, asc, eq, gt, gte, inArray, isNull, lt, sql } from "drizzle-orm";
import { db } from "../db";
import { automationReplyOnce, contact, contactIdentifier, conversation, message, optOut, replyAutomation, replyOnce, socialAccount } from "../db/schema";

/** How long a reply claim holds before another worker may take it over, while no call has started. */
export const REPLY_CLAIM_MS = 2 * 60_000;

/** One comment, mention or DM as an adapter hands it over. */
export type InboundItem = {
  userId: string;
  channel: string;
  channelInstance: string;
  /** The sender: the network's own id for them, and the name to show. */
  from: { value: string; displayName?: string | null };
  /** The network's thread: the post's comment thread, or the DM thread. */
  threadKey: string;
  externalId: string;
  kind: "comment" | "mention" | "dm";
  text: string;
  at: Date;
  /** For a comment or mention under a post: the post's id on the network. */
  postExternalId?: string | null;
  /** What answering it needs besides its id, kept so a reply put back for later can still be sent. */
  meta?: Record<string, unknown> | null;
};

export type Recorded = { messageId: string; contactId: string; conversationId: string; created: boolean };

/** An inbound message with what a reply needs to know about it. */
/** The reason on a waiting reply the owner's later automation changes ruled out. */
export const RULED_OUT = "Not sent: your automations changed while it waited, and it no longer fits them.";

export type InboundContext = {
  id: string;
  kind: string;
  text: string;
  channel: string;
  channelInstance: string;
  externalId: string | null;
  postExternalId: string | null;
  at: Date;
  conversationId: string;
  threadKey: string;
  lastInboundAt: Date | null;
  contactId: string;
  contactName: string | null;
  /** The identifier the message came from: the contact point an opt-out is recorded against. */
  contactPoint: string;
};

export type OutboundRow = typeof message.$inferSelect;
type Settle = { decision: "sent" | "held" | "failed" | "uncertain"; reason: string | null; text?: string; externalId?: string | null };

/** Raised inside the transaction when another writer created the same identifier first; the caller tries again. */
class LostIdentifierRace extends Error {}

async function recordOnce(item: InboundItem): Promise<Recorded> {
  return db().transaction(async (tx) => {
    const key = and(
      eq(contactIdentifier.userId, item.userId), eq(contactIdentifier.channel, item.channel),
      eq(contactIdentifier.channelInstance, item.channelInstance), eq(contactIdentifier.value, item.from.value),
    );
    let [found] = await tx.select({ contactId: contactIdentifier.contactId }).from(contactIdentifier).where(key);
    if (!found) {
      const id = randomUUID();
      await tx.insert(contact).values({ id, userId: item.userId, displayName: item.from.displayName ?? null, createdAt: item.at });
      [found] = await tx
        .insert(contactIdentifier)
        .values({ userId: item.userId, channel: item.channel, channelInstance: item.channelInstance, value: item.from.value, contactId: id })
        .onConflictDoNothing()
        .returning({ contactId: contactIdentifier.contactId });
      // Another writer stored this person first: roll back our contact and read theirs on the next try.
      if (!found) throw new LostIdentifierRace();
    }
    const contactId = found.contactId;
    const [conv] = await tx
      .insert(conversation)
      .values({ id: randomUUID(), userId: item.userId, contactId, channel: item.channel, channelInstance: item.channelInstance, channelThreadKey: item.threadKey })
      .onConflictDoUpdate({ target: [conversation.userId, conversation.channel, conversation.channelInstance, conversation.channelThreadKey, conversation.contactId], set: { channelThreadKey: item.threadKey } })
      .returning({ id: conversation.id });
    const [stored] = await tx
      .insert(message)
      .values({
        id: randomUUID(), userId: item.userId, conversationId: conv.id, direction: "in", kind: item.kind, text: item.text,
        channel: item.channel, channelInstance: item.channelInstance, externalId: item.externalId, postExternalId: item.postExternalId ?? null, at: item.at,
        meta: item.meta ?? null,
      })
      .onConflictDoNothing()
      .returning({ id: message.id });
    if (!stored) {
      const [existing] = await tx
        .select({ id: message.id, conversationId: message.conversationId })
        .from(message)
        .where(and(eq(message.userId, item.userId), eq(message.channel, item.channel), eq(message.channelInstance, item.channelInstance), eq(message.externalId, item.externalId)));
      return { messageId: existing.id, contactId, conversationId: existing.conversationId, created: false };
    }
    // Only a newly stored message moves the window, and never backwards: a late or repeated item cannot shrink it.
    await tx
      .update(conversation)
      .set({ lastInboundAt: sql`greatest(${conversation.lastInboundAt}, ${item.at.toISOString()}::timestamptz)` })
      .where(and(eq(conversation.id, conv.id), eq(conversation.userId, item.userId)));
    return { messageId: stored.id, contactId, conversationId: conv.id, created: true };
  });
}

/** Inbound messages and what answering them reads: the message, its thread, queued and earlier replies. */
function inboundSide() {
  return {
    /**
     * Stores an inbound comment, mention or DM once, keyed by the network's message id on that connected account.
     * The sender is found by (workspace, network, account, their id), or created.
     */
    async recordInbound(item: InboundItem): Promise<Recorded> {
      try {
        return await recordOnce(item);
      } catch (e) {
        if (e instanceof LostIdentifierRace) return recordOnce(item);
        throw e;
      }
    },

    /** An inbound message of this workspace with its conversation and sender, or null. */
    async inbound(userId: string, messageId: string): Promise<InboundContext | null> {
      const [row] = await db()
        .select({ m: message, c: conversation, name: contact.displayName })
        .from(message)
        .innerJoin(conversation, and(eq(conversation.id, message.conversationId), eq(conversation.userId, userId)))
        .innerJoin(contact, and(eq(contact.id, conversation.contactId), eq(contact.userId, userId)))
        .where(and(eq(message.userId, userId), eq(message.id, messageId), eq(message.direction, "in")));
      if (!row) return null;
      const [ident] = await db()
        .select({ value: contactIdentifier.value })
        .from(contactIdentifier)
        .where(and(eq(contactIdentifier.userId, userId), eq(contactIdentifier.contactId, row.c.contactId), eq(contactIdentifier.channel, row.m.channel), eq(contactIdentifier.channelInstance, row.m.channelInstance)));
      if (!ident) return null;
      return {
        id: row.m.id, kind: row.m.kind, text: row.m.text, channel: row.m.channel, channelInstance: row.m.channelInstance,
        externalId: row.m.externalId, postExternalId: row.m.postExternalId, at: row.m.at, conversationId: row.c.id,
        threadKey: row.c.channelThreadKey, lastInboundAt: row.c.lastInboundAt, contactId: row.c.contactId, contactName: row.name, contactPoint: ident.value,
      };
    },

    /**
     * The conversation a private reply to a comment goes in: its own thread with that contact, never the public
     * comment thread.
     */
    async privateThread(userId: string, ctx: InboundContext): Promise<string> {
      const key = `private-reply:${ctx.externalId ?? ctx.id}`;
      const [conv] = await db()
        .insert(conversation)
        .values({ id: randomUUID(), userId, contactId: ctx.contactId, channel: ctx.channel, channelInstance: ctx.channelInstance, channelThreadKey: key })
        .onConflictDoUpdate({ target: [conversation.userId, conversation.channel, conversation.channelInstance, conversation.channelThreadKey, conversation.contactId], set: { channelThreadKey: key } })
        .returning({ id: conversation.id });
      return conv.id;
    },

    /**
     * Queues a reply for the sweeper without answering now: an outbound row whose claim has already run out, so the
     * next sweep takes it and answers through the usual checks. For events a webhook stores, which must be answered
     * within seconds and so cannot wait for drafting. Queuing twice keeps one row.
     */
    async queueReply(userId: string, inboundId: string, route: "public" | "private" | "dm", now: Date): Promise<void> {
      const ctx = await this.inbound(userId, inboundId);
      if (!ctx) return;
      const conversationId = route === "private" ? await this.privateThread(userId, ctx) : ctx.conversationId;
      await db().insert(message).values({
        id: randomUUID(), userId, conversationId, direction: "out", kind: route, text: "", channel: ctx.channel, channelInstance: ctx.channelInstance,
        replyToId: ctx.id, at: now, claimedUntil: new Date(now.getTime() - 1), updatedAt: now,
      }).onConflictDoNothing();
    },

    /** An inbound message's network id and what answering it needs, for sending a reply put back earlier. */
    async inboundForSend(userId: string, inboundId: string): Promise<{ externalId: string | null; meta: Record<string, unknown> | null } | null> {
      const [row] = await db().select({ externalId: message.externalId, meta: message.meta }).from(message)
        .where(and(eq(message.userId, userId), eq(message.id, inboundId), eq(message.direction, "in"))).limit(1);
      return row ?? null;
    },

    /** This workspace's outbound replies to one inbound message. */
    async replies(userId: string, inboundId: string): Promise<OutboundRow[]> {
      return db().select().from(message).where(and(eq(message.userId, userId), eq(message.replyToId, inboundId), eq(message.direction, "out")));
    },

    /**
     * How many replies went out to this contact since `since`, on any network and route: sent, may have been sent, or
     * being sent now (every one whose call started). Held and refused replies reached nobody, so they do not count.
     */
    async repliesToContactSince(userId: string, contactId: string, since: Date): Promise<number> {
      const [row] = await db()
        .select({ n: sql<number>`count(*)::int` })
        .from(message)
        .innerJoin(conversation, and(eq(conversation.id, message.conversationId), eq(conversation.userId, userId)))
        .where(and(
          eq(message.userId, userId), eq(message.direction, "out"), eq(conversation.contactId, contactId), gte(message.callStartedAt, since),
          sql`(${message.decision} is null or ${message.decision} in ('sent', 'uncertain'))`,
        ));
      return row?.n ?? 0;
    },
  };
}

/** Claims on a reply and the once-only and opt-out marks that decide whether it may go out. */
function claimSide() {
  return {
    /**
     * Claims the one reply on this route to an inbound message. Returns the outbound row's id and this claim's token,
     * or null when another run holds it or it was already decided. A claim whose call never started is taken over
     * once it runs out.
     */
    async claim(userId: string, ctx: InboundContext, route: string, conversationId: string, now: Date, automationId: string | null = null): Promise<{ id: string; token: string } | null> {
      const token = randomUUID();
      const claimedUntil = new Date(now.getTime() + REPLY_CLAIM_MS);
      const [row] = await db()
        .insert(message)
        .values({
          id: randomUUID(), userId, conversationId, direction: "out", kind: route, text: "", channel: ctx.channel, channelInstance: ctx.channelInstance,
          replyToId: ctx.id, at: now, claimToken: token, claimedUntil, updatedAt: now, automationId,
        })
        .onConflictDoUpdate({
          target: [message.replyToId, message.kind],
          set: { claimToken: token, claimedUntil, updatedAt: now },
          setWhere: and(eq(message.userId, userId), isNull(message.decision), isNull(message.callStartedAt), lt(message.claimedUntil, now)),
        })
        .returning({ id: message.id });
      return row ? { id: row.id, token } : null;
    },

    /**
     * Takes "this automation answers this person once on this post" for this outbound row. True when this row holds
     * it, including a retry of the same row; false when another reply already holds it.
     */
    async takeAutomationOnce(userId: string, automationId: string, ctx: InboundContext, messageId: string): Promise<boolean> {
      const postKey = ctx.postExternalId ?? `thread:${ctx.threadKey}`;
      // The automation must be this person's: a foreign id never takes anyone's slot.
      const [own] = await db().select({ id: replyAutomation.id }).from(replyAutomation).where(and(eq(replyAutomation.id, automationId), eq(replyAutomation.userId, userId))).limit(1);
      if (!own) return false;
      const rows = await db()
        .insert(automationReplyOnce)
        .values({ automationId, contactId: ctx.contactId, postKey, messageId })
        .onConflictDoUpdate({
          target: [automationReplyOnce.automationId, automationReplyOnce.contactId, automationReplyOnce.postKey],
          set: { messageId },
          setWhere: eq(automationReplyOnce.messageId, messageId),
        })
        .returning({ id: automationReplyOnce.messageId });
      return rows.length === 1;
    },

    /**
     * Takes "reply privately once to this person on this post" for this outbound row. True when this row holds it,
     * including a row taken over from a worker that died before sending.
     */
    async takeReplyOnce(userId: string, ctx: InboundContext, postExternalId: string, messageId: string): Promise<boolean> {
      const rows = await db()
        .insert(replyOnce)
        .values({ userId, channelInstance: ctx.channelInstance, postExternalId, contactId: ctx.contactId, messageId })
        .onConflictDoUpdate({
          target: [replyOnce.userId, replyOnce.channelInstance, replyOnce.postExternalId, replyOnce.contactId],
          set: { messageId },
          setWhere: eq(replyOnce.messageId, messageId),
        })
        .returning({ id: replyOnce.messageId });
      return rows.length === 1;
    },

    /**
     * Settles, as held, this account's waiting replies the owner's later changes rule out: the automation that started
     * one is gone, off or moved to another account, or the account now has automations and the reply had none (they
     * decide what is answered now). Only replies no run holds and no call started are touched. Returns how many.
     */
    async dropRuledOut(userId: string, channelInstance: string, now: Date): Promise<number> {
      const live = sql`exists (select 1 from ${replyAutomation} r where r.id = ${message.automationId} and r.user_id = ${message.userId} and r.active and r.account_id = ${message.channelInstance})`;
      const accountHasAutomations = sql`exists (select 1 from ${replyAutomation} r where r.user_id = ${message.userId} and r.account_id = ${message.channelInstance} and r.active)`;
      const rows = await db()
        .update(message)
        .set({ decision: "held", reason: RULED_OUT, claimToken: null, updatedAt: now })
        .where(and(
          eq(message.userId, userId), eq(message.channelInstance, channelInstance), eq(message.direction, "out"),
          isNull(message.decision), isNull(message.callStartedAt), lt(message.claimedUntil, now),
          sql`((${message.automationId} is not null and not ${live}) or (${message.automationId} is null and ${accountHasAutomations}))`,
        ))
        .returning({ id: message.id });
      // Nothing was sent, so the "once" slots these rows held are given back.
      const ids = rows.map((x) => x.id);
      if (ids.length) {
        await db().delete(replyOnce).where(and(eq(replyOnce.userId, userId), inArray(replyOnce.messageId, ids)));
        await db().delete(automationReplyOnce).where(inArray(automationReplyOnce.messageId, ids));
      }
      return rows.length;
    },

    /** Gives an automation's "answer once" back when this row sent nothing. */
    async releaseAutomationOnce(messageId: string): Promise<void> {
      await db().delete(automationReplyOnce).where(eq(automationReplyOnce.messageId, messageId));
    },

    /** Gives "reply once" back when this row sent nothing. */
    async releaseReplyOnce(userId: string, messageId: string): Promise<void> {
      await db().delete(replyOnce).where(and(eq(replyOnce.userId, userId), eq(replyOnce.messageId, messageId)));
    },

    /** Whether this contact point asked not to get messages for this purpose (or for any purpose) on this network. */
    async optedOut(userId: string, contactPoint: string, channel: string, purpose: string): Promise<boolean> {
      const rows = await db()
        .select({ p: optOut.purpose })
        .from(optOut)
        .where(and(eq(optOut.userId, userId), eq(optOut.contactPoint, contactPoint), eq(optOut.channel, channel), inArray(optOut.purpose, [purpose, "all"])))
        .limit(1);
      return rows.length > 0;
    },

    /** Records an opt-out; recording it twice changes nothing. */
    async addOptOut(userId: string, contactPoint: string, channel: string, purpose: string, now: Date): Promise<void> {
      await db().insert(optOut).values({ userId, contactPoint, channel, purpose, at: now }).onConflictDoNothing();
    },

  };
}

/** The call itself: starting it, settling how it went, putting it back after a wait, and finding stalled ones. */
function callSide() {
  return {
    /**
     * Marks the claimed row just before the network call, with the exact text sent. False when the claim is no longer
     * this run's (taken over, or already decided); then nothing may be sent.
     */
    /**
     * Marks the call started, so the reply is never sent twice. With `liveAccount`, the mark is made only while the
     * connected account (the message's channel instance) still exists, has replies on and is not broken, in the same
     * statement: replies turned off or an account disconnected during drafting means nothing is sent.
     *
     * @returns False when the claim was taken over, or (with liveAccount) the account no longer answers
     */
    async startCall(userId: string, id: string, token: string, text: string, now: Date, liveAccount = false): Promise<boolean> {
      const live = liveAccount
        ? [
          // Replies on since before this reply began: turned off and on again while it was written means it is not sent.
          sql`exists (select 1 from ${socialAccount} a where a.id = ${message.channelInstance} and a.user_id = ${message.userId} and a.replies_on and a.broken_at is null and (a.replies_since is null or a.replies_since <= ${message.at}))`,
          // A reply an automation answered is sent only while that automation still exists, is on, and is still on this account.
          sql`(${message.automationId} is null or exists (select 1 from ${replyAutomation} r where r.id = ${message.automationId} and r.user_id = ${message.userId} and r.active and r.account_id = ${message.channelInstance}))`,
        ]
        : [];
      const rows = await db()
        .update(message)
        .set({ callStartedAt: now, text, updatedAt: now })
        .where(and(eq(message.userId, userId), eq(message.id, id), eq(message.claimToken, token), isNull(message.decision), isNull(message.callStartedAt), ...live))
        .returning({ id: message.id });
      return rows.length === 1;
    },

    /** Records this claim's decision and its reason; a claim taken over by another run is left alone. */
    async settle(userId: string, id: string, token: string, result: Settle, now: Date): Promise<boolean> {
      const rows = await db()
        .update(message)
        .set({
          decision: result.decision, reason: result.reason, updatedAt: now,
          ...(result.text !== undefined ? { text: result.text } : {}),
          ...(result.externalId ? { externalId: result.externalId } : {}),
        })
        .where(and(eq(message.userId, userId), eq(message.id, id), eq(message.claimToken, token), isNull(message.decision)))
        .returning({ id: message.id });
      return rows.length === 1;
    },

    /**
     * Puts a reply the network asked to wait on back: the call mark is cleared (the network refused, so nothing was
     * sent) and the claim runs until `at`, so no run takes it before then and the sweeper takes it after.
     */
    async retryLater(userId: string, id: string, token: string, at: Date, now: Date): Promise<boolean> {
      const rows = await db()
        .update(message)
        .set({ callStartedAt: null, claimedUntil: at, updatedAt: now })
        .where(and(eq(message.userId, userId), eq(message.id, id), eq(message.claimToken, token), isNull(message.decision)))
        .returning({ id: message.id });
      return rows.length === 1;
    },

    /**
     * Replies that were never decided and never called: put back after a wait, or left by a run that stopped. Only
     * those whose claim ran out and whose inbound message is younger than `maxAgeMs`, oldest first, across workspaces.
     */
    async stalledReplies(now: Date, maxAgeMs: number, limit: number, scope?: { userId: string; channel: string; channelInstance: string }): Promise<{ userId: string; inboundId: string; route: string; channel: string; channelInstance: string; automationId: string | null }[]> {
      const inbound = alias(message, "inbound");
      const rows = await db()
        .select({ userId: message.userId, inboundId: inbound.id, route: message.kind, channel: message.channel, channelInstance: message.channelInstance, automationId: message.automationId })
        .from(message)
        .innerJoin(inbound, and(eq(inbound.id, message.replyToId), eq(inbound.userId, message.userId)))
        .where(and(
          eq(message.direction, "out"), isNull(message.decision), isNull(message.callStartedAt), lt(message.claimedUntil, now),
          gt(inbound.at, new Date(now.getTime() - maxAgeMs)),
          // Scoped in the query, before ordering and the limit, so one account's backlog never hides another's.
          ...(scope ? [eq(message.userId, scope.userId), eq(message.channel, scope.channel), eq(message.channelInstance, scope.channelInstance)] : []),
        ))
        .orderBy(asc(inbound.at))
        .limit(limit);
      return rows;
    },

    /** How many replies went out from one connected account since `since`: sent, may have been sent, or under way. */
    async repliesFromInstanceSince(userId: string, channel: string, channelInstance: string, since: Date): Promise<number> {
      const [row] = await db()
        .select({ n: sql<number>`count(*)::int` })
        .from(message)
        .where(and(
          eq(message.userId, userId), eq(message.direction, "out"), eq(message.channel, channel), eq(message.channelInstance, channelInstance), gte(message.callStartedAt, since),
          sql`(${message.decision} is null or ${message.decision} in ('sent', 'uncertain'))`,
        ));
      return row?.n ?? 0;
    },
  };
}

/** Replies in Postgres through Drizzle. */
export function postgresReplyStore() {
  return { ...inboundSide(), ...claimSide(), ...callSide() };
}

export type ReplyStore = ReturnType<typeof postgresReplyStore>;
