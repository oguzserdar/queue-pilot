import type { Snapshot } from "../lib/buffer/snapshot";
/**
 * @fileoverview Queue Pilot's tables for the Buffer copy, sources, connected accounts and every post sent outside Buffer.
 * Part of the schema that ./schema.ts re-exports; drizzle-kit reads it through that file.
 */
import { sql } from "drizzle-orm";
import { user } from "./auth-schema";
import { boolean, index, integer, jsonb, pgEnum, pgTable, primaryKey, text, timestamp, unique, uniqueIndex } from "drizzle-orm/pg-core";

/** Where a copy goes. A Postgres enum, so the database itself refuses any other value. */
export const echoKind = pgEnum("qp_echo_kind", ["telegram", "discord", "mastodon", "bluesky", "instagram"]);
/** What happened to a copy. */
export const echoStatus = pgEnum("qp_echo_status", ["sent", "failed", "uncertain"]);

/** Admin-entered settings (Buffer app keys); secret values hold the encrypted form only. */
export const operatorSettings = pgTable("operator_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  /**
   * True once the value was saved or kept in /admin in a release where a saved value wins over the server's
   * environment. Rows from before that release default to false: the environment's value stays in use over them until
   * the operator chooses in /admin (src/lib/settings.ts).
   */
  adminWins: boolean("admin_wins").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** One saved copy of each user's Buffer queue, plus the claim that lets only one server refresh it at a time. */
export const bufferSnapshot = pgTable("buffer_snapshot", {
  userId: text("user_id").primaryKey().references(() => user.id, { onDelete: "cascade" }),
  data: jsonb("data").$type<Snapshot["data"]>(),
  rateLimit: jsonb("rate_limit").$type<Snapshot["rateLimit"]>().notNull().default([]),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }),
  refreshingUntil: timestamp("refreshing_until", { withTimezone: true }),
  /** When a write Buffer confirmed was last applied to this copy; a refresh that started earlier must not overwrite it. */
  patchedAt: timestamp("patched_at", { withTimezone: true }),
});

/**
 * Buffer posts the person took off the schedule themselves: seen as scheduled in one read of their Buffer and as a draft
 * in the next. Kept apart from the snapshot, which every refresh replaces, so the mark cannot be lost. A marked post is
 * left out of "Approve all" and can never be scheduled by an AI app; the person can still approve it on its own card.
 * The mark goes when the post is seen in any status other than draft.
 */
export const pulledBack = pgTable("qp_pulled_back", {
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  postId: text("post_id").notNull(),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.userId, t.postId] })]);

/** Feeds a user drafts from (newsletter, blog, YouTube, GitHub releases). */
export const source = pgTable(
  "qp_source",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    title: text("title").notNull(),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("qp_source_user_url").on(t.userId, t.url)],
);

/** Feed items already turned into drafts, so the AI is never offered them twice. */
export const sourceUsed = pgTable(
  "qp_source_used",
  {
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    itemKey: text("item_key").notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.itemKey] })],
);

/** Research text supplied through the connector. */
export const material = pgTable(
  "qp_material",
  {
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    title: text("title").notNull(),
    text: text("text").notNull(),
    link: text("link"),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.key] })],
)

/** Where a user's sent posts are copied: one Telegram channel and one Discord channel at most. */
export const echoDestination = pgTable(
  "qp_echo_destination",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    kind: echoKind("kind").notNull(),
    label: text("label").notNull(),
    target: text("target").notNull(),
    guildId: text("guild_id"),
    connectedAt: timestamp("connected_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("qp_echo_destination_user_kind").on(t.userId, t.kind)],
);

/**
 * A social account the person signed in to with their own credentials (Mastodon, Bluesky), to post to directly.
 * A person may connect several accounts per network. Credentials are encrypted with src/lib/secrets.ts and never
 * leave the server.
 */
export const socialAccount = pgTable(
  "qp_social_account",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    network: echoKind("network").notNull(),
    /** The network's own id for the account (a Mastodon account id, a Bluesky DID). */
    accountId: text("account_id").notNull(),
    /** What the person sees: @name@instance or the Bluesky handle. */
    handle: text("handle").notNull(),
    /** The https address of the Mastodon instance or the Bluesky server (PDS) the account lives on. */
    server: text("server").notNull(),
    /** Encrypted ("v1:" AES-256-GCM): the access token, or the app password and session. */
    credentials: text("credentials").notNull(),
    scopes: text("scopes"),
    connectedAt: timestamp("connected_at", { withTimezone: true }).notNull().defaultNow(),
    /** Set when the network refused the credentials, so the person is asked to connect again. */
    brokenAt: timestamp("broken_at", { withTimezone: true }),
    /** Whether Queue Pilot answers this account's mentions. Off until the owner turns it on. */
    repliesOn: boolean("replies_on").notNull().default(false),
    /** When replies were last turned on; nothing posted before it is ever answered. Null while replies are off. */
    repliesSince: timestamp("replies_since", { withTimezone: true }),
    /**
     * Who answers this network account, set only while replies are on (null when off): "bluesky <did>", or for
     * Mastodon "mastodon <server> <id>" with the server lowercased and without a trailing slash, since a Mastodon id
     * is unique only on its own server and a DID is global. Written by setReplies; unique, so one replier per account.
     */
    repliesOwner: text("replies_owner"),
    /** Bluesky: the signed-in session (access and refresh tokens), encrypted like credentials, so posting and reading reuse it instead of signing in each time. Null until the first sign-in. */
    session: text("session"),
    /**
     * When Queue Pilot may post to this account, per weekday, like a Buffer channel's posting schedule:
     * [{ day: "mon", paused: false, times: ["09:00"] }]. Empty until the person sets times.
     */
    postingSchedule: jsonb("posting_schedule").$type<{ day: "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun"; paused: boolean; times: string[] }[]>().notNull().default([]),
    /** The IANA time zone the posting times are in, e.g. "Europe/Istanbul". Null until times are set. */
    timeZone: text("time_zone"),
  },
  (t) => [
    // A Mastodon account id is unique only on its own server, so the server is part of the key.
    unique("qp_social_account_user_network_server_account").on(t.userId, t.network, t.server, t.accountId),
    index("qp_social_account_user_idx").on(t.userId),
    // Two people may connect one network account, but only one may have replies on, so no mention is answered twice.
    uniqueIndex("qp_social_account_replies_owner").on(t.repliesOwner),
  ],
);

/**
 * Queue Pilot's own app on one Mastodon instance (POST /api/v1/apps), registered the first time someone connects an
 * account there with this callback address, then reused. Not anyone's account: every person on the instance signs in
 * through the same app. The secret is encrypted ("v1:" AES-256-GCM under SETTINGS_KEY). If the instance stops
 * accepting it, the row is deleted and the next connect registers again.
 */
export const mastodonApp = pgTable(
  "qp_mastodon_app",
  {
    /** The instance's https origin, e.g. https://mastodon.social */
    origin: text("origin").notNull(),
    /** This deployment's callback address, which the instance only accepts exactly as registered. */
    redirectUri: text("redirect_uri").notNull(),
    clientId: text("client_id").notNull(),
    clientSecret: text("client_secret").notNull(),
    /** The scopes the app was registered with; a sign-in may only ask for these, so a change registers again. */
    scopes: text("scopes").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.origin, t.redirectUri] })],
);

/**
 * Where the reply run last read one account's mentions. No row means the account was never read since it was
 * connected or its replies were turned on: the next read only stores where it got to and answers nothing, so history
 * is never answered. The row is deleted whenever replies are turned off or the account breaks.
 *
 * Mastodon pages forward from `cursor` (a notification min_id). Bluesky pages from the newest backwards, so the run
 * stops at `seenUri`, or at anything indexed at or before `seenAt`.
 */
export const replyCursor = pgTable("qp_reply_cursor", {
  accountId: text("account_id").primaryKey().references(() => socialAccount.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  /** When the first read stored the cursor; nothing older than this is answered. Null while that read is running. */
  primedAt: timestamp("primed_at", { withTimezone: true }),
  /** Mastodon: the newest notification id handled. */
  cursor: text("cursor"),
  /** Bluesky: the newest post handled, and when it was indexed. */
  seenUri: text("seen_uri"),
  seenAt: timestamp("seen_at", { withTimezone: true }),
  /** When the last read started: one run at a time per account, and no more often than the network allows. */
  polledAt: timestamp("polled_at", { withTimezone: true }).notNull(),
});

/** One row per copy (user, post, destination): the key that keeps a copy from being sent twice. */
export const echo = pgTable(
  "qp_echo",
  {
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    postId: text("post_id").notNull(),
    destinationId: text("destination_id").notNull(),
    status: echoStatus("status").notNull(),
    attempts: integer("attempts").notNull(),
    messageId: text("message_id"),
    error: text("error"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.postId, t.destinationId] })],
);

/** A run's reservation of one copy before sending, so two runs at once cannot both send it. */
export const echoClaim = pgTable(
  "qp_echo_claim",
  {
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    postId: text("post_id").notNull(),
    destinationId: text("destination_id").notNull(),
    claimedUntil: timestamp("claimed_until", { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.postId, t.destinationId] })],
);

/**
 * A post's state at one destination. "scheduled" waits for its send time; "pending" is claimed and being sent;
 * "cancelled" was stopped before it went out. A pending row whose call started and never finished reads as
 * "uncertain".
 */
export const directPostStatus = pgEnum("qp_announcement_status", ["pending", "sent", "failed", "uncertain", "scheduled", "cancelled"]);

/**
 * One post sent to Telegram and/or Discord on its own, without a Buffer post. One row per destination, keyed
 * by (post, kind): the row is claimed before sending, so a double click or a retry can never post it twice.
 */
export const directPostSend = pgTable(
  "qp_announcement_send",
  {
    postId: text("announcement_id").notNull(),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    kind: echoKind("kind").notNull(),
    /** The Discord channel id or the Telegram chat id it was sent to. */
    target: text("target").notNull(),
    label: text("label").notNull(),
    text: text("text").notNull(),
    status: directPostStatus("status").notNull(),
    attempts: integer("attempts").notNull().default(1),
    /** "Wait" answers in a row from the network; at WAIT_CEILING the next one fails the row. A resend starts again at 0. */
    waits: integer("waits").notNull().default(0),
    link: text("link"),
    error: text("error"),
    /**
     * Set when this place follows a Buffer post: it goes out when Buffer has published that post, checked at the
     * post's time, and the automatic copy of that post stands down.
     */
    bufferPostId: text("buffer_post_id"),
    /** The Discord server the channel belongs to, so a scheduled post never lands in a server connected later. */
    guildId: text("guild_id"),
    /** When a scheduled post goes out; null for a post sent at once. */
    sendAt: timestamp("send_at", { withTimezone: true }),
    /** Bumped on every edit, time change or cancel, so a timer set for an older version cannot send. */
    revision: integer("revision").notNull().default(0),
    /** A claim that is not handed to Telegram or Discord by this time is taken back and sent again. */
    claimedUntil: timestamp("claimed_until", { withTimezone: true }),
    /** Set just before the call to Telegram or Discord. Once set, the row is never sent again on its own. */
    callStartedAt: timestamp("call_started_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // One row per destination: Mastodon and Bluesky can hold several accounts per post, so the account is in the key.
    primaryKey({ columns: [t.postId, t.kind, t.target] }),
    // Telegram and Discord stay one row per post: a follow-up's new Discord channel moves the row, never adds one.
    uniqueIndex("qp_announcement_send_one_bot_place").on(t.postId, t.kind).where(sql`${t.kind} in ('telegram', 'discord')`),
    index("qp_announcement_send_user_created").on(t.userId, t.createdAt),
    index("qp_announcement_send_due").on(t.status, t.sendAt),
    index("qp_announcement_send_buffer_post").on(t.userId, t.bufferPostId),
  ],
);

/**
 * Past posts the user picked as examples of how they write. The text is copied in, so an example survives the post
 * leaving Buffer's history; the AI reads these before drafting (get_my_voice).
 */
export const voiceExample = pgTable(
  "qp_voice_example",
  {
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    postId: text("post_id").notNull(),
    channel: text("channel").notNull(),
    text: text("text").notNull(),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.postId] })],
);

/** The user's own words about how they write ("short, plain, no emojis"), one note per user. */
export const voiceNote = pgTable("qp_voice_note", {
  userId: text("user_id").primaryKey().references(() => user.id, { onDelete: "cascade" }),
  note: text("note").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Telegram connect codes seen in the bot's updates; the first chat to carry a code keeps it. */
export const telegramCode = pgTable("qp_telegram_code", {
  code: text("code").primaryKey(),
  chatId: text("chat_id").notNull(),
  title: text("title").notNull(),
  seenAt: timestamp("seen_at", { withTimezone: true }).notNull().defaultNow(),
});
