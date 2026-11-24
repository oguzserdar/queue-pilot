import type { Verdict } from "../lib/judge";
import type { SourceMetadata } from "../lib/source-evidence";
/**
 * @fileoverview Queue Pilot's tables for playbook rules, review links, AI keys and use, admin work and the settings audit.
 * Part of the schema that ./schema.ts re-exports; drizzle-kit reads it through that file.
 */
import { sql } from "drizzle-orm";
import { oauthConsent, user } from "./auth-schema";
import { bigint, date, index, integer, jsonb, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

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
    /** What Queue Pilot wrote. Never replaced by a later check, so the person's edits stay visible as edits. */
    text: text("text").notNull(),
    /** The text the verdicts below were given for: the person's edited text after a check. Null means `text`. */
    checkedText: text("checked_text"),
    /** The playbook verdicts the draft was saved with (src/lib/judge.ts); null when it was saved unchecked. */
    verdicts: jsonb("verdicts").$type<Verdict[]>(),
    playbookRevision: text("playbook_revision"),
    savedAt: timestamp("saved_at", { withTimezone: true }).notNull().defaultNow(),
    /** Who approved the draft for scheduling: "queue-pilot" for the person in the app, else the AI app's name. Null until approved. */
    approvedBy: text("approved_by"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
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
 * Home's offers the person set aside: the first-run welcome ("Not now") and the connect-your-AI card (×). One row per
 * offer, so a hidden offer stays hidden on every device. Deleted with the account.
 */
export const offerDismissed = pgTable(
  "qp_offer_dismissed",
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
 * as the change, with the admin who made it. Secret values are never recorded: only that one was set or cleared.
 */
export const settingsAudit = pgTable("qp_settings_audit", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  key: text("key").notNull(),
  action: text("action").notNull(),
  fromValue: text("from_value"),
  toValue: text("to_value"),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  /**
   * The admin who made the change, from the server session. Null for changes recorded before this was kept. Not a
   * foreign key, so a change stays listed after that admin's account is deleted.
   */
  actorId: text("actor_id"),
});

/**
 * Queue Pilot's Buffer allowance as Buffer last reported it, one row per window ("100-in-15min" and so on). Buffer
 * counts every request of this app's client together, for all people, so the row is shared by every server instance.
 * A reading only lowers `remaining` within a window; it rises only once `resetAt` has passed.
 */
export const bufferAllowance = pgTable("qp_buffer_allowance", {
  policy: text("policy").primaryKey(),
  remaining: integer("remaining").notNull(),
  resetAt: timestamp("reset_at", { withTimezone: true }).notNull(),
  observedAt: timestamp("observed_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Buffer requests on their way out: reserved before sending, removed when Buffer answers. A reservation left behind by
 * a crashed request stops counting at `expiresAt`.
 */
export const bufferReservation = pgTable(
  "qp_buffer_reservation",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    /** When the request was reserved: only a request started after a window reset may raise that window. */
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [index("qp_buffer_reservation_expires_idx").on(t.expiresAt)],
);

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

/**
 * Drafts the in-app writer produced, saved here before they are written to Buffer. One row per posting time in a run.
 *
 * written → saved (in Buffer, postId set)
 *         ↘ refused (the playbook or Buffer turned it down; reason says why)
 *         ↘ failed (the time was filled by something else before it could be saved)
 *
 * callStartedAt is set just before the Buffer request. A row still "written" with it set means the answer never came
 * back: recovery looks at that posting time in Buffer and adopts the draft found there with the same text, and only
 * saves again when the time is still empty. The posting time is the key, so a retry can never make a second draft.
 */
export const fillDraft = pgTable(
  "qp_fill_draft",
  {
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    runId: text("run_id").notNull(),
    /** "<channelId>@<ISO time>", as open-slots.ts builds it. */
    slotId: text("slot_id").notNull(),
    text: text("text").notNull(),
    sourceKey: text("source_key"),
    snapshotId: text("snapshot_id"),
    evidence: jsonb("evidence"),
    status: text("status").$type<"written" | "saved" | "refused" | "failed">().notNull().default("written"),
    reason: text("reason"),
    postId: text("post_id"),
    callStartedAt: timestamp("call_started_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.runId, t.slotId] }), index("qp_fill_draft_open").on(t.userId, t.status)],
);

/**
 * Every admin operation run through the one door (src/lib/admin-operations.ts), from /admin or from a connected AI
 * app. A command's row is written before it runs, so a change is never made without a record; its result is filled in
 * after. The input summary holds only fields each operation allows, never a secret value. The actor is not a foreign
 * key, so the record stays after that admin's account is deleted.
 */
export const adminAudit = pgTable(
  "qp_admin_audit",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    actorId: text("actor_id"),
    /** "page", or "mcp:<the AI app's client id>". */
    via: text("via").notNull(),
    operation: text("operation").notNull(),
    input: jsonb("input").$type<Record<string, string | number | boolean | null>>(),
    /** "ok", an error code, or "pending" while a command runs. */
    result: text("result").notNull(),
  },
  (t) => [index("qp_admin_audit_at_idx").on(t.at)],
);

/**
 * Connected AI apps the admin let run admin operations, one row per admin and approval. A normal approval is never
 * enough: Queue Pilot reads other people's text, and a hidden line in it could ask the AI to call an admin tool.
 * Revoking or retiring the app deletes its approval, and with it this grant.
 */
export const appAdminGrant = pgTable(
  "qp_app_admin_grant",
  {
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    consentId: text("consent_id").notNull().references(() => oauthConsent.id, { onDelete: "cascade" }),
    grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
    /** The admin who gave it, from the server session. */
    grantedBy: text("granted_by").notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.consentId] })],
);
