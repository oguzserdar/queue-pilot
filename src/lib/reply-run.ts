/**
 * The reply run: reads the new mentions of every Mastodon and Bluesky account whose owner turned replies on, stores
 * each one (recordInbound) and answers it (answer, src/lib/replies.ts) under the owner's rules and judge.
 *
 * Guards, each with a test in reply-run.test.ts:
 * - The first read of an account, after connecting it, turning replies on or reconnecting it, only notes where the
 *   mentions are and answers none of them; nothing older than that read is ever answered.
 * - The account itself and the owner's other accounts are never answered or stored.
 * - A contact gets at most REPLIES_PER_CONTACT_HOUR replies an hour (in answer), so two auto-responders cannot loop.
 * - The mention's text reaches the drafter only as the other person's quoted words (src/lib/reply-drafter.ts).
 * - A Mastodon reply starts with @acct of the person answered; a direct one otherwise reaches nobody.
 * - A Bluesky listing stops at the first post already handled, at a repeated cursor, or after MAX_PAGES.
 * - A broken account or one with replies off is not read, and its read position is forgotten.
 *
 * The read position moves only past mentions that were handled. Reading a page again is safe: the same mention is
 * stored once and answered once.
 */
import "server-only";
import { type ReplyNetwork } from "./social-networks";
import * as mastodon from "./mastodon";
import * as bluesky from "./bluesky";
import { MAX_WAIT_SECONDS, type Cooldowns } from "./direct-posts";
import { withBlueskySession } from "./bluesky-session";
import { tooLong } from "./char-limits";
import { answer, ownerJudge, recordInbound, type DraftRequest, type ReplyDeps, type ReplyJudge, type ReplyOutcome, type SendRequest } from "./replies";
import { postgresReplyStore, type InboundItem, type ReplyStore } from "./reply-store";
import { postgresReplyCursorStore, type ReplyCursor, type ReplyCursorStore } from "./reply-cursor-store";
import { ownerDraft } from "./reply-drafter";
import { fullAcct, withMention } from "./reply-mentions";
import { postgresRulesStore } from "./rules-store";
import { ruleAccountFor } from "./rule-account";
import { activeAutomations } from "./reply-automation-store";
import { linksAllowed, matchAutomation, pickVersion, type ReplyAutomation } from "./reply-automations";
import { markAccountBroken, ownAccounts, repliesOwnerKey, replyAccounts, type ReplyAccount } from "./social-accounts";
import { postgresCooldowns } from "./cooldowns";
import { ReplyRefused, RenewFailed } from "./reply-errors";
import { SENDERS, type ReplyRoute, type SendContext, type Sender } from "./reply-senders";
import { InstagramError } from "./instagram";

/** One of the owner's connected accounts, as the run compares mention authors against it. */
export type OwnAccount = { networkAccountId: string; handle: string; server: string };

export type ReplyRunDeps = {
  store: ReplyStore;
  cursors: ReplyCursorStore;
  /** The accounts with replies on and not broken. */
  accounts: () => Promise<ReplyAccount[]>;
  /** All of this owner's accounts on a network, whatever their state. */
  own: (userId: string, network: ReplyNetwork) => Promise<OwnAccount[]>;
  draft: ReplyDeps["draft"];
  rules: ReplyDeps["rules"];
  ruleAccount?: ReplyDeps["ruleAccount"];
  /** The account's switched-on automations; the Postgres store when not given. */
  automations?: (userId: string, accountId: string) => Promise<ReplyAutomation[]>;
  /** The owner's judge, or null when they have no AI. */
  judge: (userId: string) => ReplyJudge | null;
  markBroken: (userId: string, accountId: string) => Promise<void>;
  /** The guarded GET and POST in production; fakes in tests. */
  get?: mastodon.Get;
  post?: mastodon.Post;
  now?: () => Date;
  /** Waits shared with posts to the same accounts (cooldowns.ts); none in tests that do not give it. */
  cooldowns?: Pick<Cooldowns, "active" | "note">;
};

export type ReplyRunSummary = { accounts: number; primed: number; recorded: number; sent: number; held: number; failed: number; uncertain: number; skipped: number };

/**
 * The shortest time between two reads of one account. Bluesky signs in on every read, and its server allows 300
 * sign-ins a day per account (packages/pds/src/api/com/atproto/server/createSession.ts, read 14 Nov 2026), which
 * posting shares; every 10 minutes is 144.
 */
export const READ_GAP_MS = { mastodon: 60_000, bluesky: 10 * 60_000 } as const;

/** The most pages one read of one account follows. */
export const MAX_PAGES = 5;

/** The most mentions one read of one account answers; the rest wait for the next read. */
export const MAX_ANSWERS = 20;

/**
 * No new answer starts once a run is this old, so it ends well inside the cron call's 55 seconds and the route's
 * 60, before the next call may read the same account. The rest are answered on the next read.
 */
export const RUN_ANSWER_MS = 40_000;

/** The account is cooling down after a "wait" (from a post or a reply): no call, the reply waits until it ends. */
class CoolingDown extends Error {
  constructor(readonly seconds: number) { super(`The network asked to wait, so this waits ${seconds} seconds before trying.`); }
}

const refused = (e: unknown) => e instanceof mastodon.MastodonError || e instanceof bluesky.BlueskyError || e instanceof InstagramError || e instanceof ReplyRefused || e instanceof RenewFailed || e instanceof CoolingDown;
/**
 * On a read only a 401 means the sign-in is gone. A 403 is a token without read:notifications (Mastodon answers 403
 * outside the granted scopes), which can still post, so it is logged and the account is left working.
 */
const readSignInGone = (e: unknown) => (e instanceof mastodon.MastodonError || e instanceof bluesky.BlueskyError) && e.status === 401;
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** A network's time as a Date; a missing or unreadable one reads as now. */
const timeOf = (s: string, now: Date) => {
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? now : d;
};

// The mention helpers live in their own file, with no server code, and are still reached from here.
export { fullAcct, withMention } from "./reply-mentions";

/**
 * Reads and answers the new mentions of every account with replies on. One account failing never stops the others.
 *
 * @param deps - Stores, accounts, drafter, playbook, judge and the network edge
 * @returns What the run did, in counts
 */
export async function runReplies(deps: ReplyRunDeps): Promise<ReplyRunSummary> {
  const sum: ReplyRunSummary = { accounts: 0, primed: 0, recorded: 0, sent: 0, held: 0, failed: 0, uncertain: 0, skipped: 0 };
  const now = deps.now ?? (() => new Date());
  const runStart = now().getTime();
  const accounts = await deps.accounts();
  await deps.cursors.forgetInactive(accounts.map((a) => a.id));
  for (const account of accounts) {
    sum.accounts += 1;
    try {
      await runAccount(deps, account, sum, now, runStart);
    } catch (e) {
      console.error(JSON.stringify({ event: "qp-reply-read-failed", userId: account.userId, accountId: account.id, network: account.network, message: message(e).slice(0, 300) }));
      if (readSignInGone(e)) await deps.markBroken(account.userId, account.id).catch(() => {});
    }
  }
  return sum;
}

/**
 * Everything one account's read needs. `more` says whether another answer may start (this read's MAX_ANSWERS and the
 * run's RUN_ANSWER_MS), and counts it when it may.
 */
type Read = { deps: ReplyRunDeps; account: ReplyAccount; sum: ReplyRunSummary; now: () => Date; startedAt: Date; more: () => boolean; automations: ReplyAutomation[] };

async function runAccount(deps: ReplyRunDeps, account: ReplyAccount, sum: ReplyRunSummary, now: () => Date, runStart: number): Promise<void> {
  const startedAt = now();
  // A cooling account is skipped whole, before its read is taken: reading mentions counts against the same limit, and
  // drafting or judging a reply that cannot be sent spends AI for nothing. Its mentions are read once the wait ends.
  if (deps.cooldowns) {
    const key = repliesOwnerKey({ network: account.network, server: account.server, accountId: account.networkAccountId });
    if (await deps.cooldowns.active(key, startedAt).catch(() => null)) {
      sum.skipped += 1;
      return;
    }
  }
  const reader = READERS[account.network];
  // A network whose events arrive by webhook has nothing to read: only its put-back replies are swept.
  const taken = reader ? await deps.cursors.take(account.userId, account.id, startedAt, reader.gapMs) : null;
  if (reader && !taken) {
    sum.skipped += 1;
    return;
  }
  let budget = MAX_ANSWERS;
  const more = () => {
    if (budget === 0 || now().getTime() - runStart >= RUN_ANSWER_MS) return false;
    budget -= 1;
    return true;
  };
  const automations = await (deps.automations ?? activeAutomations)(account.userId, account.id);
  const read: Read = { deps, account, sum, now, startedAt, more, automations };
  await sweep(read);
  if (reader && taken) await reader.read(read, taken);
}

/** Stores one mention and answers it on its public route; counts the result. */
async function handle(r: Read, item: Omit<InboundItem, "userId" | "channel" | "channelInstance">): Promise<void> {
  const { deps, account, sum } = r;
  const recorded = await recordInbound(deps.store, { ...item, userId: account.userId, channel: account.network, channelInstance: account.id });
  if (recorded.created) sum.recorded += 1;
  // No automation on the account: every mention is answered in the person's voice, as before. With automations, only
  // a mention one matches is answered; the rest stay in the inbox.
  if (!r.automations.length) return answerOne(r, recorded.messageId, "public", item.externalId, item.meta ?? null);
  const parent = typeof item.meta?.parent === "string" ? item.meta.parent : null;
  const automation = matchAutomation(r.automations, { text: item.text, postExternalId: item.postExternalId ?? null, parentExternalId: parent }, { owner: r.account.networkAccountId });
  if (automation) await answerOne(r, recorded.messageId, "public", item.externalId, item.meta ?? null, automation);
}

/**
 * Answers one stored mention on one route with this account's sender, and counts the result. Used for a mention just
 * read and for a reply the sweeper picks up again, so both go through the same checks and the same sender.
 */
async function answerOne(r: Read, inboundId: string, route: "public" | "private" | "dm", externalId: string, meta: Record<string, unknown> | null, automation?: ReplyAutomation): Promise<void> {
  const { deps, account, sum } = r;
  const acct = typeof meta?.acct === "string" ? meta.acct : null;
  const link = automation?.link ?? undefined;
  const replyDeps: ReplyDeps = {
    store: deps.store,
    automationId: automation?.id,
    // The mention and the length check go into the draft itself, so the judged, stored and sent text are one string.
    draft: async (req: DraftRequest) => {
      // A fixed reply is one of its versions, the same one on every retry; a voice reply is written with the link.
      let raw = automation?.replyMode === "fixed" ? pickVersion(automation.replyTexts, inboundId) : (await deps.draft({ ...req, ...(link ? { link } : {}) })).trim();
      if (link && automation?.replyMode === "fixed" && !raw.includes(link)) raw = `${raw} ${link}`;
      // A written reply must link to the owner's link and nothing else, checked on the text itself, not trusted to the prompt.
      if (link && automation?.replyMode !== "fixed" && !linksAllowed(raw, link)) throw new Error(`the reply must link only to ${link}`);
      const text = acct && raw ? withMention(raw, acct) : raw;
      const over = tooLong(account.network, text);
      if (over) throw new Error(over);
      return text;
    },
    rules: deps.rules,
    ruleAccount: deps.ruleAccount,
    judge: deps.judge(account.userId),
    send: sendFor(r, inboundId, route, externalId, meta),
    refused,
    // A network that says wait has posted nothing: the reply is put back and the sweeper sends it after the wait.
    liveAccount: true,
    waitSeconds,
    now: r.now,
  };
  const outcome: ReplyOutcome | null = await answer(replyDeps, account.userId, inboundId, route);
  if (outcome) sum[outcome.decision] += 1;
}

/** How long a refused send says to wait before trying again; undefined when it is not a wait. */
function waitSeconds(e: unknown): number | undefined {
  if (e instanceof CoolingDown) return e.seconds;
  if (e instanceof RenewFailed) return 60;
  return networkWaitSeconds(e);
}

/** How long a network itself said to wait (a 429, or Instagram's throttle codes); undefined when it did not. */
function networkWaitSeconds(e: unknown): number | undefined {
  if ((e instanceof mastodon.MastodonError || e instanceof bluesky.BlueskyError) && e.status === 429) return e.retryAfterSeconds ?? 60;
  if (e instanceof InstagramError && e.kind === "wait") return e.retryAfterSeconds ?? 60;
  return undefined;
}

/** The routes a reply can go out on. */
const REPLY_ROUTES = ["public", "private", "dm"] as const;
const isReplyRoute = (v: string): v is (typeof REPLY_ROUTES)[number] => REPLY_ROUTES.some((x) => x === v);

/** The network call that sends one reply to one stored mention, built from what was kept with it. */
function sendFor(r: Read, inboundId: string, route: ReplyRoute, externalId: string, meta: Record<string, unknown> | null): (req: SendRequest) => Promise<{ externalId: string | null }> {
  const send = networkSend(r, inboundId, route, externalId, meta);
  const { deps, account, now } = r;
  const cooldowns = deps.cooldowns;
  if (!cooldowns) return send;
  // The same key posts use, so a "wait" on either holds both.
  const key = repliesOwnerKey({ network: account.network, server: account.server, accountId: account.networkAccountId });
  return async (req) => {
    const until = await cooldowns.active(key, now()).catch(() => null);
    if (until) throw new CoolingDown(Math.max(1, Math.ceil((until.getTime() - now().getTime()) / 1000)));
    try {
      return await send(req);
    } catch (e) {
      const wait = networkWaitSeconds(e);
      // Capped like posts: the network names the time, and any server can send any time.
      if (wait !== undefined) await cooldowns.note(key, new Date(now().getTime() + Math.min(wait, MAX_WAIT_SECONDS) * 1000)).catch(() => {});
      throw e;
    }
  };
}

/** The network call itself. */
function networkSend(r: Read, inboundId: string, route: ReplyRoute, externalId: string, meta: Record<string, unknown> | null): Sender {
  const { deps, account, now } = r;
  const ctx: SendContext = { account, now, post: deps.post, markBroken: deps.markBroken, replies: (userId, id) => deps.store.replies(userId, id) };
  return SENDERS[account.network](ctx, inboundId, route, externalId, meta);
}

/** How old a mention may be for the sweeper to still answer it: after an outage, day-old mentions are left alone. */
export const SWEEP_MAX_AGE_MS = 24 * 3_600_000;

/** The oldest a mention may be to be answered at all: reading and the sweeper keep the same limit. */
const ageLimit = (at: Date) => new Date(at.getTime() - SWEEP_MAX_AGE_MS);

/** Answers this account's replies that were put back after a wait, or left by a run that stopped before calling. */
async function sweep(r: Read): Promise<void> {
  const { deps, account } = r;
  // First settle what can no longer be sent, so it never takes one of the sweep's slots.
  await deps.store.dropRuledOut(account.userId, account.id, r.now());
  const stalled = await deps.store.stalledReplies(r.now(), SWEEP_MAX_AGE_MS, MAX_ANSWERS, { userId: account.userId, channel: account.network, channelInstance: account.id });
  for (const s of stalled) {
    if (!r.more()) return;
    const info = await deps.store.inboundForSend(account.userId, s.inboundId);
    if (!info?.externalId) continue;
    // A reply an automation started is retried only with that automation, while it is still on.
    const automation = s.automationId ? r.automations.find((a) => a.id === s.automationId) : undefined;
    if (s.automationId && !automation) continue;
    // Only answer() writes a route, from these three; any other is a broken row and fails as answer() would.
    if (!isReplyRoute(s.route)) throw new Error(`A stored reply has an unknown route (${s.route}).`);
    await answerOne(r, s.inboundId, s.route, info.externalId, info.meta, automation);
  }
}

/** Mastodon pages forward from the cursor (min_id); each page is answered oldest first, then the cursor moves past it. */
async function readMastodon(r: Read, taken: ReplyCursor): Promise<void> {
  const { deps, account, sum, now, startedAt } = r;
  const token = account.credentials.token ?? "";
  if (!taken.primedAt) {
    const { nextSinceId } = await mastodon.listMentions(account.server, token, undefined, deps.get, now);
    await deps.cursors.save(account.userId, account.id, { cursor: nextSinceId ?? null }, startedAt);
    sum.primed += 1;
    return;
  }
  const primedAt = taken.primedAt;
  const own = await deps.own(account.userId, "mastodon");
  const ownAccts = new Set(own.map((o) => fullAcct(o.handle, o.server)));
  const isSelf = (m: mastodon.MastodonMention) => m.accountId === account.networkAccountId || ownAccts.has(fullAcct(m.acct, account.server));
  const save = (cursor: string) => deps.cursors.save(account.userId, account.id, { cursor }, startedAt);
  let cursor = taken.cursor ?? undefined;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const { mentions, nextSinceId } = await mastodon.listMentions(account.server, token, cursor, deps.get, now);
    // Oldest first, and the cursor moves past each mention once it is handled, so a read cut short resumes after it.
    for (const m of [...mentions].reverse()) {
      // Older than a day (after an outage) is left alone, as the sweeper does; the cursor still moves past it.
      if (!isSelf(m) && timeOf(m.createdAt, now()) >= primedAt && timeOf(m.createdAt, now()) > ageLimit(now())) {
        if (!r.more()) return;
        await handle(r, {
          from: { value: fullAcct(m.acct, account.server), displayName: m.acct }, threadKey: m.inReplyToId ?? m.statusId, externalId: m.statusId,
          kind: "mention", text: m.text, at: timeOf(m.createdAt, now()), postExternalId: m.inReplyToId,
          meta: { acct: m.acct, visibility: m.visibility },
        });
      }
      await save(m.id);
    }
    // The page's newest id also passes notifications that were not readable mentions.
    if (!nextSinceId || nextSinceId === cursor) return;
    await save(nextSinceId);
    cursor = nextSinceId;
    if (mentions.length < mastodon.MENTIONS_PAGE_LIMIT) return;
  }
}

/**
 * Bluesky lists newest first and its cursor walks to older posts, so the read collects from the top until it reaches
 * the newest post already handled (or one indexed before it, or before the first read), then answers oldest first,
 * moving the mark past each one.
 */
async function readBluesky(r: Read, taken: ReplyCursor): Promise<void> {
  const { deps, account, sum, now, startedAt } = r;
  // The account's kept session, renewed once when it expired, instead of a sign-in on every read.
  const list: BlueskyList = (cursor) => withBlueskySession(account.userId, account, (s) => bluesky.listMentions(account.server, s, cursor, deps.get, now), { post: deps.post });
  if (!taken.primedAt) {
    const { mentions } = await list(undefined);
    const newest = mentions[0];
    await deps.cursors.save(account.userId, account.id, { seenUri: newest?.uri ?? null, seenAt: newest ? timeOf(newest.indexedAt, now()) : null }, startedAt);
    sum.primed += 1;
    return;
  }
  const read = await collectBluesky(r, taken, taken.primedAt, list);
  if (read.kind === "restart") return;
  // Out of pages before reaching what was already seen: older unread mentions lie below. The seen mark may only move
  // over an unbroken range, so nothing is answered now; the next read continues from here, and the newer pages are
  // read again (and answered) once the older ones are done.
  if (read.kind === "capped") {
    await deps.cursors.save(account.userId, account.id, { cursor: read.resumeAt }, startedAt);
    return;
  }
  if (!(await answerBluesky(r, read.collected))) return;
  // This slice is done: the next read starts from the top again.
  if (taken.cursor) await deps.cursors.save(account.userId, account.id, { cursor: null }, startedAt);
}

type BlueskyList = (cursor: string | undefined) => Promise<{ mentions: bluesky.BlueskyMention[]; cursor: string | undefined }>;

/** Whether a mention is where the read stops: already handled, before the mark or the first read, or over a day old. */
function isBoundary(m: bluesky.BlueskyMention, taken: ReplyCursor, primedAt: Date, now: () => Date): boolean {
  const at = timeOf(m.indexedAt, now());
  // Older than a day (after an outage) is a boundary too, the same limit the sweeper keeps: it is never answered.
  return m.uri === taken.seenUri || Boolean(taken.seenAt && at < taken.seenAt) || at < primedAt || at <= ageLimit(now());
}

/** What one read of the mentions found: the mentions down to the seen mark, or where to resume, or a restart. */
type BlueskyRead = { kind: "seen"; collected: bluesky.BlueskyMention[] } | { kind: "capped"; resumeAt: string | null } | { kind: "restart" };

/**
 * Collects from the top (or the saved place) until the newest mention already handled. A backlog longer than one read
 * comes back "capped" with where to continue; a saved place Bluesky no longer takes comes back "restart".
 */
async function collectBluesky(r: Read, taken: ReplyCursor, primedAt: Date, list: BlueskyList): Promise<BlueskyRead> {
  const { deps, account, now, startedAt } = r;
  const collected: bluesky.BlueskyMention[] = [];
  const cursorsSeen = new Set<string>();
  // A backlog longer than one read: the last read saved where it stopped (Bluesky's cursor is a time, so it stays
  // valid), and this one continues from there instead of the top.
  let cursor: string | undefined = taken.cursor ?? undefined;
  // Where the read stops when the backlog is long: after MAX_PAGES pages. One more page is read only to see whether the
  // seen mark starts it; without that look, an unread range of exactly MAX_PAGES pages would be capped on every read.
  let stopAt: string | undefined;
  for (let page = 0; page <= MAX_PAGES; page += 1) {
    if (page === MAX_PAGES) stopAt = cursor;
    let listed: Awaited<ReturnType<BlueskyList>>;
    try {
      listed = await list(cursor);
    } catch (e) {
      // A saved place Bluesky no longer takes: start again from the top next time; the seen mark never moves here.
      if (taken.cursor && cursor === taken.cursor && e instanceof bluesky.BlueskyError && e.status === 400) {
        await deps.cursors.save(account.userId, account.id, { cursor: null }, startedAt);
        return { kind: "restart" };
      }
      throw e;
    }
    const boundary = listed.mentions.findIndex((m) => isBoundary(m, taken, primedAt, now));
    collected.push(...(boundary === -1 ? listed.mentions : listed.mentions.slice(0, boundary)));
    if (boundary !== -1) return { kind: "seen", collected };
    // A short or empty page with a cursor is normal; the same cursor twice means nothing older is coming.
    if (!listed.cursor || cursorsSeen.has(listed.cursor)) return { kind: "seen", collected };
    cursorsSeen.add(listed.cursor);
    cursor = listed.cursor;
  }
  return { kind: "capped", resumeAt: stopAt ?? cursor ?? null };
}

/**
 * Answers the collected mentions oldest first, moving the mark past each one once it is handled, so a read cut short
 * resumes after it. False when the run's allowance ran out first.
 */
async function answerBluesky(r: Read, collected: bluesky.BlueskyMention[]): Promise<boolean> {
  const { deps, account, now, startedAt } = r;
  const own = new Set((await deps.own(account.userId, "bluesky")).map((o) => o.networkAccountId).concat(account.networkAccountId));
  for (const m of collected.reverse()) {
    if (!own.has(m.authorDid)) {
      if (!r.more()) return false;
      await handle(r, {
        from: { value: m.authorDid, displayName: m.handle }, threadKey: m.root?.uri ?? m.uri, externalId: m.uri,
        kind: m.reason === "reply" ? "comment" : "mention", text: m.text, at: timeOf(m.indexedAt, now()), postExternalId: m.root?.uri ?? null,
        meta: { cid: m.cid, root: m.root ?? null, parent: m.parent?.uri ?? null },
      });
    }
    await deps.cursors.save(account.userId, account.id, { seenUri: m.uri, seenAt: timeOf(m.indexedAt, now()) }, startedAt);
  }
  return true;
}

/** The production wiring: Postgres stores, the owner's AI to draft and judge, the guarded network edge. */
export function replyRunDeps(): ReplyRunDeps {
  return {
    store: postgresReplyStore(),
    cursors: postgresReplyCursorStore(),
    accounts: replyAccounts,
    own: ownAccounts,
    draft: ownerDraft,
    rules: (userId) => postgresRulesStore().list(userId),
    judge: ownerJudge,
    ruleAccount: ruleAccountFor,
    markBroken: (userId, accountId) => markAccountBroken(userId, accountId),
    cooldowns: postgresCooldowns(),
  };
}

/** Runs the replies for every account, logging what it did. */
export async function runDueReplies(deps: ReplyRunDeps = replyRunDeps()): Promise<ReplyRunSummary> {
  const sum = await runReplies(deps);
  console.log(JSON.stringify({ event: "qp-reply-run", ...sum }));
  return sum;
}

/**
 * How each network's mentions are read, and how long a read waits after the last one. A network whose comments and
 * messages arrive by webhook (Instagram) has no reader: the run only sends its replies.
 */
const READERS: Record<ReplyNetwork, { read: (r: Read, taken: ReplyCursor) => Promise<void>; gapMs: number } | null> = {
  mastodon: { read: readMastodon, gapMs: READ_GAP_MS.mastodon },
  bluesky: { read: readBluesky, gapMs: READ_GAP_MS.bluesky },
  instagram: null,
};

