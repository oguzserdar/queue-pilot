import type { SourceMetadata } from "../lib/source-evidence";
/**
 * Queue Pilot's own tables (Drizzle). Better Auth's tables are generated into auth-schema.ts by its CLI
 * (`auth generate --adapter drizzle`); both files feed drizzle-kit, which writes the migrations in ../../drizzle.
 * Every table is keyed or scoped by the signed-in user's id.
 */
import { sql } from "drizzle-orm";
import { user } from "./auth-schema";
import { bigint, date, index, integer, jsonb, pgEnum, pgTable, primaryKey, text, timestamp, unique } from "drizzle-orm/pg-core";

/** Where a copy goes. A Postgres enum, so the database itself refuses any other value. */
export const echoKind = pgEnum("qp_echo_kind", ["telegram", "discord"]);
/** What happened to a copy. */
export const echoStatus = pgEnum("qp_echo_status", ["sent", "failed"]);

/** Admin-entered settings (Buffer app keys); secret values hold the encrypted form only. */
export const operatorSettings = pgTable("operator_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** One saved copy of each user's Buffer queue, plus the claim that lets only one server refresh it at a time. */
export const bufferSnapshot = pgTable("buffer_snapshot", {
  userId: text("user_id").primaryKey().references(() => user.id, { onDelete: "cascade" }),
  data: jsonb("data"),
  rateLimit: jsonb("rate_limit").notNull().default([]),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }),
  refreshingUntil: timestamp("refreshing_until", { withTimezone: true }),
  /** When a write Buffer confirmed was last applied to this copy; a refresh that started earlier must not overwrite it. */
  patchedAt: timestamp("patched_at", { withTimezone: true }),
});

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


/**
 * Playbook rules, one row per rule. `spec` holds the rule as src/lib/rules.ts defines it (kind, text, channels, level
 * and the kind's own fields), so a new rule kind needs no table change. `fixes` counts the edits the rule came from.
 */
export const rule = pgTable("qp_rule", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  spec: jsonb("spec").notNull(),
  fixes: integer("fixes").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * The exact text Queue Pilot saved for each draft it put in Buffer. Comparing it with the post's text in Buffer later
 * shows what the person changed (src/lib/fixes.ts); a fix made twice is offered as a playbook rule.
 */
export const written = pgTable(
  "qp_written",
  {
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    postId: text("post_id").notNull(),
    network: text("network").notNull(),
    text: text("text").notNull(),
    /** The playbook verdicts the draft was saved with (src/lib/judge.ts); null when it was saved unchecked. */
    verdicts: jsonb("verdicts"),
    playbookRevision: text("playbook_revision"),
    savedAt: timestamp("saved_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.postId] })],
);

/** Repeated fixes the person set aside with "Not now", so the Playbook does not offer them again. */
export const fixDismissed = pgTable(
  "qp_fix_dismissed",
  {
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    dismissedAt: timestamp("dismissed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.key] })],
);

/**
 * A person's own AI key for drafting inside the web app. Stored encrypted (src/lib/secrets.ts, AES-256-GCM under
 * SETTINGS_KEY); only the masked form is ever shown. One key per person.
 */
export const aiKey = pgTable("qp_ai_key", {
  userId: text("user_id").primaryKey().references(() => user.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(),
  keyEnc: text("key_enc").notNull(),
  /** The model chosen from the provider's own list (src/lib/ai-models.ts). */
  model: text("model"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * AI actions each person ran on Queue Pilot's built-in key, per UTC day (src/lib/ai-allowance.ts). People with their
 * own key are not counted.
 */
export const aiUsage = pgTable(
  "qp_ai_usage",
  {
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    day: date("day").notNull(),
    actions: integer("actions").notNull().default(0),
    /** What those actions cost, in millionths of a US dollar (src/lib/ai-meter.ts). */
    costMicros: bigint("cost_micros", { mode: "number" }).notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.userId, t.day] })],
);

/** All AI actions on the built-in key per UTC day, for the total daily cap. */
export const aiUsageTotal = pgTable("qp_ai_usage_total", {
  day: date("day").primaryKey(),
  actions: integer("actions").notNull().default(0),
  /** Spent that day on the built-in key, in millionths of a US dollar. Summed against the budget. */
  costMicros: bigint("cost_micros", { mode: "number" }).notNull().default(0),
});

/**
 * Every change to an operator setting in /admin (src/lib/db.ts postgresSettingsStore), written in the same transaction
 * as the change. Secret values are never recorded: only that one was set or cleared.
 */
export const settingsAudit = pgTable("qp_settings_audit", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  key: text("key").notNull(),
  action: text("action").notNull(),
  fromValue: text("from_value"),
  toValue: text("to_value"),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Request counters for Queue Pilot's own surfaces (src/lib/rate-limit.ts): one row per key, action and fixed window,
 * so every server instance shares one count. Better Auth's /api/auth limits use its own rate_limit table.
 */
export const requestCount = pgTable(
  "qp_request_count",
  {
    key: text("key").notNull(),
    action: text("action").notNull(),
    bucket: timestamp("bucket", { withTimezone: true }).notNull(),
    count: integer("count").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.key, t.action, t.bucket] }), index("qp_request_count_bucket_idx").on(t.bucket)],
);

/**
 * The name a person gave one of their AI app connections ("Grok Bot desktop"), so two connections from the same app
 * can be told apart. One row per person and AI app; removed with the connection.
 */
export const aiAppLabel = pgTable(
  "qp_ai_app_label",
  {
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    clientId: text("client_id").notNull(),
    label: text("label").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.clientId] })],
);

/**
 * When each AI app the person approved last used the connector, so the Connect screen can show "last used 2 min ago"
 * instead of an approval that may never have been used. One row per person and AI app, updated on every connector call.
 */
export const aiAppUse = pgTable(
  "qp_ai_app_use",
  {
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    clientId: text("client_id").notNull(),
    firstUsedAt: timestamp("first_used_at", { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }).notNull().defaultNow(),
    calls: integer("calls").notNull().default(1),
  },
  (t) => [primaryKey({ columns: [t.userId, t.clientId] })],
);

/**
 * Security events the person can see in Settings: signing in, revoking an AI app. Deleting the account deletes the
 * person's events with it, then leaves one anonymous "account deleted" row so the operator can prove deletions happen.
 */
export const securityEvent = pgTable(
  "qp_security_event",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()::text`),
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    event: text("event").notNull(),
    detail: jsonb("detail").$type<Record<string, string>>(),
    ip: text("ip"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("qp_security_event_user_idx").on(t.userId, t.createdAt)],
);

/**
 * The AI's answers for one exact set of repeated fixes (src/lib/fix-verdicts.ts), so asking again about the same
 * unchanged repeats costs no AI action. Keyed by a hash of the exact check input; it expires on its own.
 */
export const fixVerdict = pgTable(
  "qp_fix_verdict",
  {
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    inputHash: text("input_hash").notNull(),
    /** [{ candidate, verdict, why }] as the model answered. Never tokens or rules. */
    verdicts: jsonb("verdicts").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.inputHash] })],
);

/**
 * A review link the person shared (src/lib/review-store.ts). The id is the unguessable token in the link. `drafts`
 * is a copy of the drafts they chose, taken when they shared, so a reviewer never reaches Buffer or anything else.
 * A link works until the person turns it off (`revokedAt`).
 */
export const reviewLink = pgTable(
  "qp_review_link",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    /** [{ postId, network, channel, dueAt, text }] as shared. */
    drafts: jsonb("drafts").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull().default(sql`now() + interval '7 days'`),
  },
  (t) => [index("qp_review_link_user_idx").on(t.userId, t.createdAt)],
);

/**
 * A reviewer's comment on one shared draft, optionally on a highlighted span of its text (`quote` is that span,
 * from `start` to `end`). Written by someone without an account, so it is untrusted text: it only ever becomes a
 * suggested rule the person can keep or skip.
 */
export const reviewComment = pgTable(
  "qp_review_comment",
  {
    id: text("id").primaryKey(),
    linkId: text("link_id").notNull().references(() => reviewLink.id, { onDelete: "cascade" }),
    postId: text("post_id").notNull(),
    name: text("name").notNull(),
    text: text("text").notNull(),
    quote: text("quote"),
    start: integer("start"),
    end: integer("end"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("qp_review_comment_link_idx").on(t.linkId, t.createdAt)],
);

/** Inheritance choices belong to a person, even when there are no rules yet. */
export const ruleInheritance = pgTable("qp_rule_inheritance", {
  userId: text("user_id").primaryKey().references(() => user.id, { onDelete: "cascade" }),
  settings: jsonb("settings").notNull().default({}),
});

/** What a connected AI app may do for this person. Approve schedules real posts, so it is the person's choice. */
export const agentPermission = pgTable("qp_agent_permission", {
  userId: text("user_id").primaryKey().references(() => user.id, { onDelete: "cascade" }),
  /** "ask": the app shows the drafts and needs a yes in the chat. "direct": no confirm step. "off": the person approves. */
  approve: text("approve").notNull().default("ask"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * A confirmation token from approve_drafts, claimed when it is used so it schedules at most once. The row is removed
 * again when nothing was scheduled, so a failed attempt can be retried with the same yes.
 */
export const approvalClaim = pgTable("qp_approval_claim", {
  nonce: text("nonce").primaryKey(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  claimedAt: timestamp("claimed_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Immutable source versions. lastCheckedAt alone advances on an unchanged report. */
export const sourceSnapshot = pgTable("qp_source_snapshot", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  sourceKey: text("source_key").notNull(),
  uri: text("uri").notNull(),
  contentHash: text("content_hash").notNull(),
  text: text("text").notNull(),
  title: text("title"),
  checkedBy: text("checked_by").notNull(),
  metadata: jsonb("metadata").$type<SourceMetadata>().notNull().default({}),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [index("qp_source_snapshot_latest").on(t.userId, t.sourceKey, t.fetchedAt)]);

/** Original evidence survives later checks. A judgment belongs to one exact draft and source version. */
export const draftEvidence = pgTable("qp_draft_evidence", {
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  bufferPostId: text("buffer_post_id").notNull(),
  snapshotId: text("snapshot_id").notNull().references(() => sourceSnapshot.id, { onDelete: "cascade" }),
  claim: text("claim").notNull(),
  quote: text("quote"),
  locator: text("locator"),
  draftText: text("draft_text").notNull(),
  judgment: jsonb("judgment").$type<{ snapshotId: string; draftText: string; holds: boolean; why: string; rewrite?: string; checkedAt: string }>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [primaryKey({ columns: [t.userId, t.bufferPostId, t.snapshotId, t.claim] })]);

/** Expiring leases and pending transcript job IDs survive server restarts. Tokens fence stale workers. */
export const sourceJob = pgTable("qp_source_job", {
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  key: text("key").notNull(),
  token: text("token").notNull(),
  value: jsonb("value").$type<{ jobId?: string }>().notNull().default({}),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, t => [primaryKey({ columns: [t.userId, t.key] })]);

/**
 * A promotion of a Buffer channel-less draft that Queue Pilot started: written before the promote request, so a
 * recovery after an unclear answer adopts only posts this app asked Buffer to create, never another app's.
 * fingerprint hashes the versions (account, text, slot time, source and evidence); token is the starting call's claim;
 * recordedAt is set once every draft is recorded as QP's own.
 */
export const promotionAttempt = pgTable(
  "qp_promotion_attempt",
  {
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    contentItemId: text("content_item_id").notNull(),
    fingerprint: text("fingerprint").notNull(),
    /** The claim of the call that started this attempt; only that call may complete it. */
    token: text("token").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    recordedAt: timestamp("recorded_at", { withTimezone: true }),
  },
  (t) => [primaryKey({ columns: [t.userId, t.contentItemId] })],
);
