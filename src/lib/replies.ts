/**
 * Answers comments, mentions and DMs in the owner's voice, under their playbook and the judge. No network code lives
 * here: an adapter stores what came in (recordInbound) and hands over a sender.
 *
 * A reply that passes the rules and the judge is sent on its own; there is no approve-every-reply step. One a rule,
 * the judge, the send window or an opt-out stops is held, with the reason, for the inbox. Every decision is written
 * on the outbound row, so the row is the evidence log.
 *
 * Sending mirrors the post engine (src/lib/direct-posts.ts): claim the row, mark it just before the network call,
 * then record the result. Two workers never send the same reply. A call that got no answer may have landed, so it
 * is "uncertain" and never sent again.
 */
import { judgeDrafts, rulesFor, type JudgeInput, type Verdict } from "./judge";
import { judgeModelFor } from "./judge-model";
import type { Rule } from "./rules";
import { resolveRule } from "./rule-scopes";
import type { InboundContext, InboundItem, Recorded, ReplyStore } from "./reply-store";

/** public: under the comment. private: a DM answering a comment. dm: in a DM thread. */
export type ReplyRoute = "public" | "private" | "dm";

/** The purpose an opt-out from replies is recorded under; "all" covers every purpose. */
export const REPLY_PURPOSE = "replies";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/**
 * How long after the message each network lets a reply go out, per route. null: no window. A route missing from a
 * network cannot be used there. Network names are the playbook's (src/lib/rules.ts NETWORKS), so rules for a network
 * reach its replies; a Facebook Page's Messenger DMs are "facebook". Instagram and Facebook allow one private reply within 7 days of the comment and other
 * DMs within 24 hours of the person's last message; Mastodon and Bluesky have no window.
 */
export const REPLY_WINDOWS: Record<string, Partial<Record<ReplyRoute, number | null>>> = {
  instagram: { public: null, private: 7 * DAY, dm: DAY },
  facebook: { public: null, private: 7 * DAY, dm: DAY },
  whatsapp: { dm: DAY },
  mastodon: { public: null, private: null, dm: null },
  bluesky: { public: null, private: null, dm: null },
};

export const WINDOW_CLOSED = "window closed";

/**
 * At most this many replies go out to one contact in an hour, across networks. Two auto-responders mentioning each
 * other would otherwise answer forever; past the limit a reply is held with REPLY_LIMIT.
 */
export const REPLIES_PER_CONTACT_HOUR = 3;
/**
 * The most replies one connected account sends in an hour. A post that asks people to comment a word can draw hundreds
 * of comments, each costing a draft and a judgment; past this, replies wait in the inbox instead of going out in bulk.
 */
export const REPLIES_PER_ACCOUNT_HOUR = 30;
/** The reason on a reply held because its account reached REPLIES_PER_ACCOUNT_HOUR. */
export const ACCOUNT_REPLY_LIMIT = "account reply limit";
/** Which playbook account a connected account is: matched to one, or the Buffer accounts on its network it could be. */
export type RuleAccount = { id?: string; candidates: string[] };
/** The reason on a reply an automation skipped because it already answered this person on this post. */
export const ANSWERED_ONCE = "This automation already answered this person on this post.";
/** The reason on a reply held because replies were turned off, or the account disconnected, while it was drafted. */
export const REPLIES_OFF = "Replies were turned off for this account before it was sent.";
export const REPLY_LIMIT = "reply limit";

/**
 * Whether a reply may still go out. A private reply counts from the comment; a DM from the person's last message.
 *
 * @param channel - The network
 * @param route - Where the reply goes
 * @param times - When the comment was made, and the conversation's last inbound message
 * @param now - The current time
 * @returns Open, or closed with the reason
 */
export function windowOpen(channel: string, route: ReplyRoute, times: { commentAt: Date; lastInboundAt: Date | null }, now: Date): { open: true } | { open: false; reason: string } {
  const network = REPLY_WINDOWS[channel];
  if (!network) return { open: false, reason: `No reply rules are known for ${channel}, so nothing is sent there.` };
  if (!(route in network)) return { open: false, reason: `${channel} has no ${route} replies.` };
  const limit = network[route];
  if (limit === null || limit === undefined) return { open: true };
  const from = route === "dm" ? times.lastInboundAt : times.commentAt;
  if (!from || now.getTime() - from.getTime() > limit) return { open: false, reason: WINDOW_CLOSED };
  return { open: true };
}

/** What the drafter gets: the message to answer and where the reply goes. */
export type DraftRequest = {
  userId: string; channel: string; channelInstance: string; route: ReplyRoute; inbound: { kind: string; text: string }; contactName: string | null;
  /** The owner's link the reply must end with (from an automation); no other link is allowed. */
  link?: string;
};

/** What the sender gets. `key` is the outbound row's id, fixed for its life, for networks that accept a retry key. */
export type SendRequest = {
  userId: string;
  channel: string;
  channelInstance: string;
  route: ReplyRoute;
  threadKey: string;
  replyToExternalId: string | null;
  contactPoint: string;
  text: string;
  key: string;
};

/** Judges drafts against rules, the same shape the save path uses: verdicts by slot id. */
export type ReplyJudge = (drafts: JudgeInput[], rules: Rule[]) => Promise<Map<string, Verdict[]>>;

export type ReplyDeps = {
  store: ReplyStore;
  /** Writes the reply in the owner's voice with their AI. */
  draft: (req: DraftRequest) => Promise<string>;
  /** The owner's playbook. */
  rules: (userId: string) => Promise<Rule[]>;
  /**
   * Which playbook account (a rule's accountIds hold Buffer channel ids) the connected account is. `id` when it is
   * matched to exactly one; `candidates` are the Buffer accounts on the same network it could be. When it is not
   * matched, the rules written for every candidate are judged too, so an unsure match never skips a rule. Null (or no
   * function) when nothing says which Buffer accounts exist: every account-limited rule is judged.
   */
  ruleAccount?: (userId: string, channel: string, channelInstance: string) => Promise<RuleAccount | null>;
  /** The judge; null when the owner has no AI to judge with, which holds every reply a rule applies to. */
  judge: ReplyJudge | null;
  send: (req: SendRequest) => Promise<{ externalId: string | null }>;
  /** True when the network refused, so nothing was sent. */
  refused: (e: unknown) => boolean;
  /** The automation answering, kept on the reply row so it is sent only while that automation is on. */
  automationId?: string;
  /** Send only while the connected account still has replies on (checked in the same statement as the call mark). */
  liveAccount?: boolean;
  /** For a refusal that says to wait (a rate limit): how many seconds. The reply is then put back, not failed. */
  waitSeconds?: (e: unknown) => number | undefined;
  now?: () => Date;
};

export type ReplyDecision = { decision: "send"; text: string } | { decision: "hold"; reason: string; text: string };
export type ReplyOutcome = { id: string; decision: "sent" | "held" | "failed" | "uncertain"; reason: string | null; text: string };

/** A reply whose call started this long ago with no result is shown as "may have been sent". */
export const REPLY_PENDING_MS = 2 * 60_000;

/**
 * How an outbound row reads now: its decision, or, while undecided, "sending", or "uncertain" once a call started
 * and got no result in time (the worker died mid-call). Such a row is never sent again either way.
 */
export function shownDecision(row: { decision: string | null; callStartedAt: Date | null }, now: Date): string {
  if (row.decision) return row.decision;
  return row.callStartedAt && now.getTime() - row.callStartedAt.getTime() > REPLY_PENDING_MS ? "uncertain" : "sending";
}

const UNSURE_SENT = "No answer in time, so it may have been sent. It is never sent again.";
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Stores an inbound comment, mention or DM once; the same webhook or poll item twice is one row. */
export function recordInbound(store: ReplyStore, item: InboundItem): Promise<Recorded> {
  return store.recordInbound(item);
}

/** Why a verdict stops a reply, naming the rule. */
function stopReason(v: Verdict): string {
  if (v.verdict === "fail") return `Rule "${v.rule}": ${v.reason}${v.quote ? ` (found "${v.quote}")` : ""}`.trim();
  return `Rule "${v.rule}" could not be confirmed: ${v.reason}`;
}

/**
 * Drafts a reply and runs the owner's rules for this network and account through the judge. With no approve step,
 * anything short of a pass holds: a failed rule of either level, an unsure verdict, a missing answer, or a judge that
 * could not run. A draft no rule applies to is sent.
 *
 * @param deps - Drafter, playbook and judge
 * @param ctx - The inbound message
 * @param route - Where the reply goes
 * @returns Send with the text, or hold with the reason
 */
/**
 * The rules a reply on this account is judged against. Matched to one Buffer account: exactly that account's rules.
 * Not matched: the shared and network rules, plus every rule written for an account it could be (all of them when
 * nothing says which it could be), so a rule is judged one time too many rather than skipped.
 */
/** True when the rule can apply to a named account: written for accounts, or switched on for one. */
const appliesToSomeAccount = (r: Rule) => !!r.accountIds?.length || Object.values(r.overrides?.accounts ?? {}).some(Boolean);

/** True when which account this is changes the rule: the same three cases the draft check looks the account up for. */
const dependsOnAccount = (r: Rule) => !!(r.accountIds?.length || r.inheritance || r.overrides?.accounts);

function applicableRules(rules: Rule[], network: string, account: RuleAccount | null): Rule[] {
  if (account?.id) return rulesFor(rules, network, account.id);
  const base = rulesFor(rules, network);
  // The judge filters by account again, so an unmatched account's extra rules go to it unscoped (every network,
  // no account list); otherwise it would drop them and the rule would be skipped after all.
  const extra = rules
    .filter((r) => !base.includes(r) && (account === null ? appliesToSomeAccount(r) : account.candidates.some((id) => resolveRule(r, network, id).applies)))
    .map((r): Rule => ({ ...r, channels: "all", accountIds: undefined, except: undefined, overrides: undefined, inheritance: undefined }));
  return [...base, ...extra];
}

export async function decideReply(deps: Pick<ReplyDeps, "draft" | "rules" | "judge" | "ruleAccount">, userId: string, ctx: InboundContext, route: ReplyRoute): Promise<ReplyDecision> {
  let text: string;
  try {
    text = (await deps.draft({ userId, channel: ctx.channel, channelInstance: ctx.channelInstance, route, inbound: { kind: ctx.kind, text: ctx.text }, contactName: ctx.contactName })).trim();
  } catch (e) {
    return { decision: "hold", reason: `Not drafted: ${message(e)}`, text: "" };
  }
  if (!text) return { decision: "hold", reason: "Not drafted: the AI wrote no reply.", text };
  let rules: Rule[];
  let account: RuleAccount | null;
  try {
    rules = await deps.rules(userId);
    // Only a rule that depends on the account (named accounts, inheritance, per-account overrides) needs to know which it is.
    account = deps.ruleAccount && rules.some(dependsOnAccount) ? await deps.ruleAccount(userId, ctx.channel, ctx.channelInstance) : null;
  } catch {
    return { decision: "hold", reason: "Not checked: the playbook could not be read.", text };
  }
  const applicable = applicableRules(rules, ctx.channel, account);
  if (!applicable.length) return { decision: "send", text };
  if (!deps.judge) return { decision: "hold", reason: "Not checked: no AI is available to judge this reply.", text };
  let verdicts: Verdict[];
  try {
    verdicts = (await deps.judge([{ slotId: ctx.id, text, network: ctx.channel, channelId: account?.id }], applicable)).get(ctx.id) ?? [];
  } catch (e) {
    return { decision: "hold", reason: `Not checked: the judge could not run (${message(e)}).`, text };
  }
  const answers = applicable.map((r) => verdicts.find((v) => v.ruleId === r.id) ?? { ruleId: r.id, rule: r.text, level: r.level, verdict: "unsure" as const, probability: null, quote: "", reason: "The check gave no answer for this rule.", unavailable: true });
  const stops = answers.filter((v) => v.verdict !== "pass");
  return stops.length ? { decision: "hold", reason: stops.map(stopReason).join(" "), text } : { decision: "send", text };
}

/** Which routes answer which kind of inbound message. */
const ROUTES: Record<string, ReplyRoute[]> = { comment: ["public", "private"], mention: ["public", "private"], dm: ["dm"] };

/**
 * Answers one inbound message on one route, once. Returns null when another run holds this reply or it was already
 * decided. Order: claim, opt-out, window, reply limit, reply once, draft and judge, opt-out again, mark the call, send,
 * record.
 *
 * @param deps - Store, drafter, playbook, judge and sender
 * @param userId - The workspace
 * @param inboundId - The stored inbound message
 * @param route - Where the reply goes
 * @returns What was decided, with its reason
 * @throws Error when the message is not this workspace's, or the route does not fit it
 */
export async function answer(deps: ReplyDeps, userId: string, inboundId: string, route: ReplyRoute): Promise<ReplyOutcome | null> {
  const now = deps.now ?? (() => new Date());
  const { store } = deps;
  const ctx = await store.inbound(userId, inboundId);
  if (!ctx) throw new Error("No such message.");
  if (!ROUTES[ctx.kind]?.includes(route)) throw new Error(`A ${ctx.kind} cannot get a ${route} reply.`);
  const conversationId = route === "private" ? await store.privateThread(userId, ctx) : ctx.conversationId;
  const claim = await store.claim(userId, ctx, route, conversationId, now(), deps.automationId ?? null);
  if (!claim) return null;
  const c: Claimed = { deps, userId, ctx, route, claim, now };

  const early = await gateBeforeDraft(c);
  if (early !== GO) return early.result;

  const decided = await decideReply(deps, userId, ctx, route);
  if (decided.decision === "hold") return recordOutcome(c, "held", decided.reason, decided.text);
  // Drafting and judging take seconds; an opt-out that arrived meanwhile still wins.
  if (await optedOutNow(c)) return recordOutcome(c, "held", "This person opted out of replies.", decided.text);
  return sendDecided(c, decided.text);
}

/** One claimed reply on its way through answer(). */
type Claimed = { deps: ReplyDeps; userId: string; ctx: InboundContext; route: ReplyRoute; claim: { id: string; token: string }; now: () => Date };

/** Whether this person opted out of replies, read now. */
const optedOutNow = (c: Claimed) => c.deps.store.optedOut(c.userId, c.ctx.contactPoint, c.ctx.channel, REPLY_PURPOSE);

/** Records what was decided for the claimed reply; null when a run that took over the claim settled it instead. */
async function recordOutcome(c: Claimed, decision: ReplyOutcome["decision"], reason: string | null, text: string, externalId?: string | null): Promise<ReplyOutcome | null> {
  const { store, automationId } = c.deps;
  // Settle first: a run whose claim was taken over must not release the claim the live run relies on.
  if (!(await store.settle(c.userId, c.claim.id, c.claim.token, { decision, reason, text, externalId }, c.now()))) return null;
  // Nothing was sent (held, or refused), so this person on this post can still get a reply later, private or from
  // the automation. Only the slot this row holds is given back.
  if (decision === "held" || decision === "failed") {
    await store.releaseReplyOnce(c.userId, c.claim.id);
    if (automationId) await store.releaseAutomationOnce(c.claim.id);
  }
  return { id: c.claim.id, decision, reason, text };
}

/** Holds a reply whose once-only slot another reply holds: not ours to release, so only this row is settled. */
async function heldByAnother(c: Claimed, reason: string): Promise<ReplyOutcome | null> {
  if (!(await c.deps.store.settle(c.userId, c.claim.id, c.claim.token, { decision: "held", reason, text: "" }, c.now()))) return null;
  return { id: c.claim.id, decision: "held", reason, text: "" };
}

const GO = "go";

/** The checks before drafting: opt-out, window, reply limits, reply once. GO when the reply may be drafted. */
async function gateBeforeDraft(c: Claimed): Promise<{ result: ReplyOutcome | null } | typeof GO> {
  const { store, automationId } = c.deps;
  const { ctx, userId, route, now } = c;
  if (await optedOutNow(c)) return { result: await recordOutcome(c, "held", "This person opted out of replies.", "") };
  const window = windowOpen(ctx.channel, route, { commentAt: ctx.at, lastInboundAt: ctx.lastInboundAt }, now());
  if (!window.open) return { result: await recordOutcome(c, "held", window.reason, "") };
  // Before drafting, so a loop with another auto-responder spends no AI either.
  if ((await store.repliesToContactSince(userId, ctx.contactId, new Date(now().getTime() - HOUR))) >= REPLIES_PER_CONTACT_HOUR) return { result: await recordOutcome(c, "held", REPLY_LIMIT, "") };
  if ((await store.repliesFromInstanceSince(userId, ctx.channel, ctx.channelInstance, new Date(now().getTime() - HOUR))) >= REPLIES_PER_ACCOUNT_HOUR) return { result: await recordOutcome(c, "held", ACCOUNT_REPLY_LIMIT, "") };
  if (route === "private" && ctx.postExternalId && !(await store.takeReplyOnce(userId, ctx, ctx.postExternalId, c.claim.id))) {
    return { result: await heldByAnother(c, "Already replied privately to this person on this post.") };
  }
  if (automationId && !(await store.takeAutomationOnce(userId, automationId, ctx, c.claim.id))) return { result: await heldByAnother(c, ANSWERED_ONCE) };
  return GO;
}

/** Marks the call, sends the drafted reply and records how it went. */
async function sendDecided(c: Claimed, text: string): Promise<ReplyOutcome | null> {
  const { deps, ctx, userId, route, claim, now } = c;
  if (!(await deps.store.startCall(userId, claim.id, claim.token, text, now(), deps.liveAccount))) {
    // Replies were turned off or the account disconnected while drafting: record it as held, so it is not retried.
    if (deps.liveAccount) return recordOutcome(c, "held", REPLIES_OFF, text);
    return null;
  }
  const req: SendRequest = {
    userId, channel: ctx.channel, channelInstance: ctx.channelInstance, route, threadKey: ctx.threadKey,
    replyToExternalId: ctx.externalId, contactPoint: ctx.contactPoint, text, key: claim.id,
  };
  try {
    const { externalId } = await deps.send(req);
    // Returned, not awaited: a failure to record is not a failure to send, so it must not reach the catch below.
    return recordOutcome(c, "sent", null, text, externalId);
  } catch (e) {
    const wait = deps.refused(e) ? deps.waitSeconds?.(e) : undefined;
    if (wait !== undefined) {
      // The network said wait, so nothing was sent: put it back for the sweeper after the wait, never fail it.
      await deps.store.retryLater(userId, claim.id, claim.token, new Date(now().getTime() + Math.max(1, wait) * 1000), now());
      return null;
    }
    if (deps.refused(e)) return recordOutcome(c, "failed", `Refused: ${message(e)}`, text);
    console.error(JSON.stringify({ event: "qp-reply-uncertain", userId, messageId: claim.id, channel: ctx.channel, message: message(e).slice(0, 300) }));
    return recordOutcome(c, "uncertain", UNSURE_SENT, text);
  }
}

/**
 * The judge on the owner's own AI, for production wiring. The AI is taken only when a rule applies, so a reply with
 * no rules spends nothing. No usable AI (none set up, or the daily allowance used up) throws, which holds the reply
 * as not checked. Cost on the built-in key is recorded after the judgment, or given back when it failed.
 */
export function ownerJudge(userId: string): ReplyJudge {
  return async (drafts, rules) => {
    const jm = await judgeModelFor(userId);
    if (!jm) throw new Error("no AI is set up");
    try {
      const verdicts = await judgeDrafts(jm.judges, drafts, rules);
      await jm.settle();
      return verdicts;
    } catch (e) {
      await jm.giveBack();
      throw e;
    }
  };
}
