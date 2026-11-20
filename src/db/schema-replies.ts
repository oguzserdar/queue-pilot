/**
 * @fileoverview Queue Pilot's tables for replies: contacts, conversations, messages, opt-outs, agent sign-up and cooldowns.
 * Part of the schema that ./schema.ts re-exports; drizzle-kit reads it through that file.
 */
import { sql } from "drizzle-orm";
import { user } from "./auth-schema";
import { socialAccount } from "./schema-posting";
import { boolean, check, index, integer, jsonb, pgTable, primaryKey, text, timestamp, unique } from "drizzle-orm/pg-core";

/**
 * Replies: the people who comment, mention or write a DM, and every message in and out. A workspace is one user here.
 * None of these people needs a Queue Pilot account. `channel` is plain text (instagram, messenger, mastodon, ...) so a
 * new network needs no ALTER TYPE; `channel_instance` is the connected account on that network (a Page id, an
 * Instagram account id, a Mastodon account id).
 */
export const contact = pgTable(
  "qp_contact",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    displayName: text("display_name"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("qp_contact_user_idx").on(t.userId)],
);

/**
 * How a contact is found again: by the workspace, the network, the connected account and the network's own id for the
 * person. Never by the value alone, so the same person writing to two workspaces is two contacts.
 */
export const contactIdentifier = pgTable(
  "qp_contact_identifier",
  {
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    channel: text("channel").notNull(),
    channelInstance: text("channel_instance").notNull(),
    value: text("value").notNull(),
    contactId: text("contact_id").notNull().references(() => contact.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.channel, t.channelInstance, t.value] }), index("qp_contact_identifier_contact_idx").on(t.contactId)],
);

/**
 * One thread with one contact on one connected account. A public comment thread and a private DM thread are two
 * conversations, never merged.
 */
export const conversation = pgTable(
  "qp_conversation",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    contactId: text("contact_id").notNull().references(() => contact.id, { onDelete: "cascade" }),
    channel: text("channel").notNull(),
    channelInstance: text("channel_instance").notNull(),
    channelThreadKey: text("channel_thread_key").notNull(),
    /** The newest inbound message's time; the 24-hour DM window counts from it. */
    lastInboundAt: timestamp("last_inbound_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("qp_conversation_thread").on(t.userId, t.channel, t.channelInstance, t.channelThreadKey, t.contactId)],
);

/**
 * Every message in and out, and the evidence log: an outbound row carries its decision and the reason.
 *
 * Inbound: decision null. Outbound: claimed (decision null, claimedUntil set) → callStartedAt set → sent | failed |
 * uncertain; or held (a rule, the judge, the window or an opt-out stopped it). The (replyToId, route) key is the claim,
 * so one inbound message gets at most one reply per route. A claim whose call never started can be taken over after
 * claimedUntil; once callStartedAt is set the row is never sent again.
 */
export const message = pgTable(
  "qp_message",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    conversationId: text("conversation_id").notNull().references(() => conversation.id, { onDelete: "cascade" }),
    direction: text("direction").$type<"in" | "out">().notNull(),
    /** Inbound: comment, mention or dm. Outbound: the route, public (a reply under the comment), private (a DM answering a comment) or dm. */
    kind: text("kind").notNull(),
    text: text("text").notNull(),
    /** Denormalized from the conversation, so the network's message id is unique per connected account. */
    channel: text("channel").notNull(),
    channelInstance: text("channel_instance").notNull(),
    /** The network's own id for the message; set on an outbound reply once the network answers. */
    externalId: text("external_id"),
    /** For a comment: the post it is on, as the network names it. */
    postExternalId: text("post_external_id"),
    /** For an outbound reply: the inbound message it answers. */
    replyToId: text("reply_to_id"),
    at: timestamp("at", { withTimezone: true }).notNull(),
    decision: text("decision").$type<"sent" | "held" | "failed" | "uncertain">(),
    reason: text("reason"),
    claimToken: text("claim_token"),
    claimedUntil: timestamp("claimed_until", { withTimezone: true }),
    callStartedAt: timestamp("call_started_at", { withTimezone: true }),
    /** Inbound: what answering it needs besides its id (Mastodon: acct and visibility; Bluesky: cid and thread root). */
    meta: jsonb("meta").$type<Record<string, unknown>>(),
    /**
     * Outbound: the automation that answered, if one did. No foreign key on purpose: deleting an automation keeps the
     * reply history, and a reply whose automation is gone or switched off is never sent (startCall checks it).
     */
    automationId: text("automation_id"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("qp_message_external").on(t.userId, t.channel, t.channelInstance, t.externalId),
    unique("qp_message_reply_claim").on(t.replyToId, t.kind),
    index("qp_message_conversation_idx").on(t.conversationId, t.at),
    index("qp_message_inbox_idx").on(t.userId, t.decision),
  ],
);

/**
 * "Reply privately once per person per post", taken before the send and released when nothing was sent. A reply that
 * may have landed keeps it.
 */
export const replyOnce = pgTable(
  "qp_reply_once",
  {
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    channelInstance: text("channel_instance").notNull(),
    postExternalId: text("post_external_id").notNull(),
    contactId: text("contact_id").notNull().references(() => contact.id, { onDelete: "cascade" }),
    /** The outbound reply holding the claim. */
    messageId: text("message_id").notNull(),
    claimedAt: timestamp("claimed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.channelInstance, t.postExternalId, t.contactId] })],
);

/** A person who asked not to be messaged, scoped by workspace, contact point, network and purpose. Checked before every send. */
export const optOut = pgTable(
  "qp_opt_out",
  {
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    contactPoint: text("contact_point").notNull(),
    channel: text("channel").notNull(),
    purpose: text("purpose").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.contactPoint, t.channel, t.purpose] })],
);

/**
 * Agent sign-up (src/lib/agent-signup/). An AI agent registers itself with no person present, works at once on private
 * material and drafts, and a person later claims it. These four tables hold that layer beside Better Auth's own: an
 * unclaimed agent never gets a row in "user", so nothing it does can reach a person's Buffer, sources, voice or admin
 * access. Ownership is one column, qp_agent_registration.user_id; artifacts, tickets and grants hang off the
 * registration, so attaching the registration attaches everything, and deleting the person deletes it all.
 *
 * The deadlines are not stored. Freeze and delete are computed from created_at by lifecycle() in envelope.ts, so the
 * request path, the cleanup job and the tests cannot disagree about them.
 */
export const agentRegistration = pgTable(
  "qp_agent_registration",
  {
    /** reg_..., also the `sub` of every token the agent holds. */
    id: text("id").primaryKey(),
    /** Null until a person claims it. Cascade: deleting the person deletes the agents they took on, and their work. */
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    /** What the agent says it is (lowercase, a-z 0-9 . _ -) and a name its person will recognise; both plain text. */
    tool: text("tool"),
    label: text("label"),
    /** The skill or page that sent the agent here, for counts. */
    source: text("source"),
    /** login_hint, lower-cased. A hint, never proof: it gives the agent nothing and is never copied into "user". */
    ownerEmailHint: text("owner_email_hint"),
    /** The live assertion's jti. A refreshed or revoked assertion no longer matches, so the token endpoint refuses it. */
    assertionJti: text("assertion_jti").notNull(),
    assertionExpiresAt: timestamp("assertion_expires_at", { withTimezone: true }).notNull(),
    /** HMAC of the caller's address under a server key: counts and abuse review without keeping the address. */
    ipHash: text("ip_hash"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    /** "self", "unticked" or "abuse". */
    revokedReason: text("revoked_reason"),
  },
  (t) => [index("qp_agent_registration_user_idx").on(t.userId), index("qp_agent_registration_created_idx").on(t.createdAt)],
);

/**
 * What an agent saved: material (notes, links, transcripts) and private drafts. Never written to Buffer. On claim,
 * material is also copied into the person's qp_material; drafts stay here, owned through the registration.
 */
export const agentArtifact = pgTable(
  "qp_agent_artifact",
  {
    /** art_... */
    id: text("id").primaryKey(),
    registrationId: text("registration_id").notNull().references(() => agentRegistration.id, { onDelete: "cascade" }),
    kind: text("kind").$type<"material" | "draft">().notNull(),
    title: text("title").notNull(),
    text: text("text").notNull(),
    link: text("link"),
    /** A hash of the content, so the same save retried keeps one row. */
    contentKey: text("content_key").notNull(),
    /** The qp_material key this was copied to at claim, or null. */
    copiedTo: text("copied_to"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("qp_agent_artifact_content").on(t.registrationId, t.kind, t.contentKey),
    index("qp_agent_artifact_list_idx").on(t.registrationId, t.kind, t.createdAt),
    check("qp_agent_artifact_kind", sql`${t.kind} in ('material', 'draft')`),
  ],
);

/**
 * One way to claim one registration. A link ticket is made at registration and its URL is rebuilt from this row's id
 * with a server secret (claim-link.ts), so no usable link is stored. "Used once" is used_at, set inside the accept
 * transaction; accepting voids every other live ticket of the registration.
 */
export const claimTicket = pgTable(
  "qp_claim_ticket",
  {
    id: text("id").primaryKey(),
    registrationId: text("registration_id").notNull().references(() => agentRegistration.id, { onDelete: "cascade" }),
    route: text("route").$type<"link" | "computer" | "email" | "sign_in">().notNull(),
    state: text("state").$type<"live" | "used" | "expired" | "cancelled" | "blocked" | "dismissed" | "void">().notNull().default("live"),
    /** The computer route's code, as an HMAC (claim-link.ts hashClaimCode). Null on the other routes. */
    codeHash: text("code_hash"),
    /** Wrong codes so far; the fifth locks the ticket. */
    attempts: integer("attempts").notNull().default(0),
    /** The email route's address, hashed; binds the ticket to it. */
    addressHash: text("address_hash"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /** Null for link tickets: they live until the account is deleted. */
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    usedAt: timestamp("used_at", { withTimezone: true }),
    /** Who accepted it; set to null if that person is later deleted. */
    claimedBy: text("claimed_by").references(() => user.id, { onDelete: "set null" }),
    lastPolledAt: timestamp("last_polled_at", { withTimezone: true }),
  },
  (t) => [
    index("qp_claim_ticket_registration_idx").on(t.registrationId, t.state),
    check("qp_claim_ticket_route", sql`${t.route} in ('link', 'computer', 'email', 'sign_in')`),
    check("qp_claim_ticket_state", sql`${t.state} in ('live', 'used', 'expired', 'cancelled', 'blocked', 'dismissed', 'void')`),
  ],
);

/**
 * What an agent may do, one row per capability. The list is closed and has no admin capability, so no claim and no
 * bug in the claim path can grant admin access through this table: the database refuses any other value.
 */
export const agentGrant = pgTable(
  "qp_agent_grant",
  {
    registrationId: text("registration_id").notNull().references(() => agentRegistration.id, { onDelete: "cascade" }),
    capability: text("capability").$type<"save_material" | "save_drafts">().notNull(),
    /** "register" for what every agent gets at once; "claim" once a person kept it on their account. */
    source: text("source").$type<"register" | "claim">().notNull(),
    grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
    /** The person who kept it at claim; null for the starting grants. */
    grantedBy: text("granted_by").references(() => user.id, { onDelete: "set null" }),
  },
  (t) => [
    primaryKey({ columns: [t.registrationId, t.capability] }),
    check("qp_agent_grant_capability", sql`${t.capability} in ('save_material', 'save_drafts')`),
    check("qp_agent_grant_source", sql`${t.source} in ('register', 'claim')`),
  ],
);

/**
 * An automatic reply on one connected account: which post, which words, and what the reply says. Deleted with the
 * account (the automation is for that one account; widening it to others would answer where nobody asked).
 */
export const replyAutomation = pgTable(
  "qp_reply_automation",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    accountId: text("account_id").notNull().references(() => socialAccount.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    active: boolean("active").notNull().default(true),
    /** "any": comments on any post; "post": only on post_external_id. */
    postScope: text("post_scope").notNull().default("any"),
    postExternalId: text("post_external_id"),
    /** Whole-word keywords; empty means any comment. */
    keywords: text("keywords").array().notNull().default(sql`'{}'::text[]`),
    /** "voice": the AI writes it in the person's voice; "fixed": one of reply_texts. */
    replyMode: text("reply_mode").notNull().default("voice"),
    replyTexts: text("reply_texts").array().notNull().default(sql`'{}'::text[]`),
    /** A link every reply must carry; a reply without it is held. */
    link: text("link"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("qp_reply_automation_account_idx").on(t.userId, t.accountId),
    check("qp_reply_automation_scope", sql`(${t.postScope} = 'any' and ${t.postExternalId} is null) or (${t.postScope} = 'post' and ${t.postExternalId} is not null)`),
    check("qp_reply_automation_mode", sql`(${t.replyMode} = 'voice') or (${t.replyMode} = 'fixed' and cardinality(${t.replyTexts}) between 1 and 10)`),
    check("qp_reply_automation_keywords", sql`cardinality(${t.keywords}) <= 20`),
  ],
);

/**
 * One answer per person per post from each automation, however many times they comment the keyword. Taken by the
 * outbound reply before it is drafted; a retry of the same reply keeps it. A mention not on a post uses its thread.
 */
export const automationReplyOnce = pgTable(
  "qp_automation_reply_once",
  {
    automationId: text("automation_id").notNull().references(() => replyAutomation.id, { onDelete: "cascade" }),
    contactId: text("contact_id").notNull().references(() => contact.id, { onDelete: "cascade" }),
    postKey: text("post_key").notNull(),
    /** The outbound reply holding it. */
    messageId: text("message_id").notNull(),
    claimedAt: timestamp("claimed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.automationId, t.contactId, t.postKey] })],
);

/**
 * A "wait" from a network that covers every post to one place until `until`. The key names what
 * the network counts the limit by: a Mastodon or Bluesky account (as repliesOwnerKey builds it), a Discord channel or
 * a Telegram chat. Rows past `until` are ignored and may be cleared.
 */
export const cooldown = pgTable("qp_cooldown", {
  key: text("key").primaryKey(),
  until: timestamp("until", { withTimezone: true }).notNull(),
});
