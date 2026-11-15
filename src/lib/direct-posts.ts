/**
 * Posts to Telegram and Discord on their own, with no Buffer post behind them: sent at once, or scheduled for a time.
 * Each destination is claimed before sending, so a double click, two tabs, two workers or a retry never post it twice.
 * A refusal from Telegram or Discord is "failed" and can be sent again by the person. The row is marked just before
 * the call to Telegram or Discord: a claim that never reached that point (the worker died first) is taken back and
 * sent later, while a call that got no answer is "uncertain", because it may have landed, and is never resent.
 */
import type { SocialNetwork } from "./social-networks";

export type PostKind = "telegram" | "discord" | SocialNetwork;

/**
 * One destination of a post: the kind and the connected account or channel. Telegram and Discord are one per post
 * (the person's one channel and one server), so their target can change on a follow-up; Mastodon and Bluesky are one
 * per connected account, so one post can go to several accounts of the same network.
 */
export type Place = { kind: PostKind; target: string };
/** Kinds with at most one destination per post. */
export const ONE_PER_POST: ReadonlySet<PostKind> = new Set(["telegram", "discord"]);
export type DirectPostStatus = "pending" | "sent" | "failed" | "uncertain" | "scheduled" | "cancelled";

/** What the person confirmed for one destination: where, and the exact text that goes there. */
export type PostItem = {
  kind: PostKind;
  target: string;
  label: string;
  text: string;
  /** For Discord, the server the channel is in; checked again at send time. */
  guildId?: string | null;
};

/** One destination's row, as stored and as shown. */
export type DirectPostRow = PostItem & {
  postId: string;
  status: DirectPostStatus;
  attempts: number;
  /** "Wait" answers in a row; see WAIT_CEILING. */
  waits: number;
  link: string | null;
  error: string | null;
  /** When a scheduled post goes out; null for one sent at once. */
  sendAt: Date | null;
  /** Bumped on every edit, time change or cancel. */
  revision: number;
  /** Set just before the call to Telegram or Discord. */
  callStartedAt: Date | null;
  /** Until when the current claim holds; null on rows written before claims were recorded. */
  claimedUntil: Date | null;
  /** The Buffer post this place follows, or null for a post of its own. */
  bufferPostId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * What Buffer says about a followed post: published, not yet (with its current time), gone (failed, deleted, or
 * never published by Buffer), or not readable right now (rate limit, network).
 */
export type BufferState =
  | { state: "sent" }
  | { state: "waiting"; dueAt: Date | null }
  | { state: "gone"; reason: string }
  | { state: "busy" };

/** A row picked up by the due run, with its owner. */
export type DueRow = DirectPostRow & { userId: string };

/** What can change on a scheduled post before it goes out. */
/**
 * A change to a scheduled post. `texts` is keyed by "kind|target" for one account's text, or by kind for every place
 * of that kind without its own; the account's own key wins.
 */
export type ScheduleChange = { sendAt?: Date; texts?: Partial<Record<PostKind | `${PostKind}|${string}`, string>> };

/** The new text for one place in a change, or undefined to keep its text. */
export const textFor = (change: ScheduleChange, p: Place): string | undefined => change.texts?.[`${p.kind}|${p.target}`] ?? change.texts?.[p.kind];

export type DirectPostStore = {
  /** Claims one destination of a new post to send now; false when it already exists. */
  claim(userId: string, postId: string, item: PostItem, now: Date): Promise<boolean>;
  /** Stores one destination of a new post to send at sendAt; false when it already exists. With bufferPostId, it follows that Buffer post. */
  schedule(userId: string, postId: string, item: PostItem, sendAt: Date, now: Date, bufferPostId?: string): Promise<boolean>;
  /**
   * Turns one place of a follow-up on, or updates it: a new row, or a scheduled or cancelled one set to wait again
   * with this text. A place already sent, sending or failed is left as it is; returns false then.
   */
  follow(userId: string, postId: string, item: PostItem, sendAt: Date, now: Date, bufferPostId: string): Promise<boolean>;
  /** Turns one place of a follow-up off while it still waits. */
  unfollow(userId: string, postId: string, place: Place, now: Date): Promise<void>;
  /**
   * Puts a claimed row back to wait, before any call was made (its Buffer post is not out yet): until `holdUntil`
   * with its time unchanged, or at a new `sendAt` when Buffer moved the post later.
   */
  defer(userId: string, postId: string, place: Place, when: { sendAt?: Date; holdUntil?: Date }, now: Date): Promise<void>;
  /**
   * After the network refused with "wait", the row waits until then and is sent again. Returns false, changing
   * nothing, when the row already waited WAIT_CEILING times in a row; the caller then fails it.
   */
  retryLater(userId: string, postId: string, place: Place, until: Date, now: Date): Promise<boolean>;
  /** This person's follow-up places still waiting, for these Buffer posts. */
  waitingFollowUps(userId: string, bufferPostIds: string[]): Promise<DirectPostRow[]>;
  /**
   * The places of these Buffer posts a follow-up covers, as "bufferPostId|kind": waiting, sending or done. A cancelled
   * place, or one that failed before any call (Buffer gone or late), does not count, so the automatic copy can send it.
   */
  followedPlaces(userId: string, bufferPostIds: string[]): Promise<Set<string>>;
  /** Changes the time or text of this person's scheduled destinations; returns the rows still scheduled. */
  reschedule(userId: string, postId: string, change: ScheduleChange, now: Date): Promise<DirectPostRow[]>;
  /** Cancels this person's scheduled destinations; returns how many were cancelled. */
  cancel(userId: string, postId: string, now: Date): Promise<number>;
  /** Cancels this person's sends to one kind of place that have not started, when they disconnect it; returns how many. */
  cancelKind(userId: string, kind: PostKind, now: Date): Promise<number>;
  /**
   * Claims rows that are due: scheduled at or before now, or claimed earlier by a worker that died before calling
   * Telegram or Discord. With `only`, just that post, at that revision or older (a place added later than the
   * timer's revision waits for its own timer). Two workers never get the same row.
   */
  claimDue(now: Date, limit: number, only?: { postId: string; revision: number }): Promise<DueRow[]>;
  /**
   * Gives a claimed row back before its call started (the run ran out of time): its claim ends now, so the next run
   * takes it at once. A row whose call started is left alone.
   */
  release(userId: string, postId: string, place: Place, now: Date): Promise<void>;
  /**
   * Puts a claimed row back to wait until `until`, before any call, because its place is cooling down. Its wait count
   * does not change (it was not told to wait itself); a send-now row gets `until` as its time.
   */
  hold(userId: string, postId: string, place: Place, until: Date, now: Date): Promise<void>;
  /** Marks a claimed row just before the call; false when it is no longer this run's to send. */
  startCall(userId: string, postId: string, place: Place, now: Date): Promise<boolean>;
  /** This person's rows for one post, so a repeated submit returns what was recorded. */
  rows(userId: string, postId: string): Promise<DirectPostRow[]>;
  /** Claims a failed destination of a post of its own again for a resend (never a follow-up); the row, else null. */
  reclaimFailed(userId: string, postId: string, place: Place, now: Date): Promise<DirectPostRow | null>;
  /** Records the result of a claimed row; a row no longer pending (taken over by another run) is left alone. */
  finish(userId: string, postId: string, place: Place, result: { status: DirectPostStatus; link: string | null; error: string | null }, now: Date): Promise<void>;
  recent(userId: string, limit: number): Promise<DirectPostRow[]>;
  /**
   * This person's Mastodon and Bluesky rows that fall in [start, end) for a week view: a scheduled row by its send
   * time, a row sent at once by when it was made. Cancelled rows are left out. Oldest first.
   */
  between(userId: string, start: Date, end: Date): Promise<DirectPostRow[]>;
};

/**
 * Waits shared by every post to one place (what each network's "wait" covers). `key` names
 * what the network counts the limit by, or null when the place has none; `note` never shortens a longer wait.
 */
export type Cooldowns = {
  key(item: PostItem, userId: string): Promise<string | null>;
  /** A wider key a refusal names (a Discord wait for the whole bot), noted and checked besides the place's own. */
  wider?(key: string, e?: unknown): string | null;
  active(key: string, now: Date): Promise<Date | null>;
  note(key: string, until: Date): Promise<void>;
};

export type DirectPostDeps = {
  store: DirectPostStore;
  /** Per-place waits; without it each row waits on its own. */
  cooldowns?: Cooldowns;
  /**
   * Checks, before any call, that the place can be posted to (still connected, bot set up). A refusal fails the row;
   * any other error leaves it claimed, so it is tried again once the claim runs out.
   */
  ready?: (item: PostItem, userId: string) => Promise<void>;
  /** Posts the exact text; returns a link to the message when the destination has one. */
  /** `ref` names the row: its post id and when the row was created, both fixed for its life (stable retry keys). */
  post: (item: PostItem, userId: string, ref: { postId: string; createdAt: Date }) => Promise<{ link: string | null }>;
  /** True when the destination answered with a refusal, so nothing was posted. */
  refused: (e: unknown) => boolean;
  /** Reads a person's followed Buffer posts at once, by id; without it, followed rows wait. Throws when Buffer cannot be read. */
  bufferCheck?: (userId: string, bufferPostIds: string[]) => Promise<Map<string, BufferState>>;
  now?: () => Date;
};

export type DirectPostResult = { kind: PostKind; target: string; label: string; status: DirectPostStatus; link: string | null; error: string | null };

/** A call older than this with no result is shown as "may have been sent". */
export const PENDING_MS = 2 * 60_000;
/** A claim not handed to Telegram or Discord within this time is taken back and sent again. */
export const CLAIM_MS = 2 * 60_000;
/** The longest wait a post is held for; a network asking for longer fails the post with the reason. */
export const MAX_WAIT_SECONDS = 6 * 3600;
const tooLongWait = (kind: PostKind) => `${PLACE_NAME[kind]} asked to wait more than 6 hours, so this was not sent. Send it again later.`;
/** Most "wait" answers in a row before a post is failed instead of waiting again. */
export const WAIT_CEILING = 5;
/** The wait asked for, plus up to a tenth more, so posts told to wait together do not all come back at once. */
export const withJitter = (seconds: number, random: () => number = Math.random) => Math.max(1, seconds) * (1 + random() / 10);
/** How far ahead a post can be scheduled. */
export const MAX_AHEAD_MS = 60 * 86_400_000;
const UNSURE = "No answer in time, so it may have been sent. Check the channel.";

/** How each kind of place is named to people. */
export const PLACE_NAME: Record<PostKind, string> = { telegram: "Telegram", discord: "Discord", mastodon: "Mastodon", bluesky: "Bluesky" };

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
/** Seconds Telegram or Discord asked us to wait, when the refusal was a rate limit. */
const waitSeconds = (e: unknown): number | undefined =>
  typeof e === "object" && e !== null && "retryAfterSeconds" in e && typeof e.retryAfterSeconds === "number" ? e.retryAfterSeconds : undefined;
/** An error for the logs: never post text, and a bot token in a request URL is masked. */
export const forLog = (e: unknown) => message(e).replace(/bot\d+:[\w-]+/g, "bot<token>").slice(0, 300);

/** Records a claimed row as not sent, with the reason, and returns that result. */
async function fail(deps: DirectPostDeps, userId: string, postId: string, item: Pick<PostItem, "kind" | "target" | "label">, error: string): Promise<DirectPostResult> {
  await deps.store.finish(userId, postId, item, { status: "failed", link: null, error }, (deps.now ?? (() => new Date()))());
  return { kind: item.kind, target: item.target, label: item.label, status: "failed", link: null, error };
}

/** A place's cooldowns and its key, when the place has one. */
type Cool = { cooldowns: Cooldowns; key: string } | null;
/** One claimed row being sent. */
type Sending = { userId: string; postId: string; item: PostItem; deps: DirectPostDeps; now: () => Date; cool: Cool };

const resultFor = (item: PostItem, r: { status: DirectPostStatus; link: string | null; error: string | null }): DirectPostResult =>
  ({ kind: item.kind, target: item.target, label: item.label, ...r });
const waiting = (item: PostItem) => resultFor(item, { status: "scheduled", link: null, error: null });
const READY = "ready";

/** Holds this row and leaves it scheduled until the given time. */
const holdUntil = (s: Sending, until: Date) => s.deps.store.hold(s.userId, s.postId, s.item, until, s.now()).then(() => waiting(s.item));

/** When the place's cooldown (or the wider one it falls under) ends; undefined when it is not cooling down. */
async function coolingUntil(cool: NonNullable<Cool>, now: () => Date): Promise<Date | undefined> {
  const wide = cool.cooldowns.wider?.(cool.key) ?? null;
  const ends = await Promise.all([cool.key, ...(wide ? [wide] : [])].map((k) => cool.cooldowns.active(k, now()).catch(() => null)));
  return ends.filter((d): d is Date => !!d).sort((a, b) => b.getTime() - a.getTime())[0];
}

/** Gets the place ready. READY when it is; a result when the row was held or failed; null to leave it claimed. */
async function getReady(s: Sending): Promise<DirectPostResult | null | typeof READY> {
  const { deps, item } = s;
  if (!deps.ready) return READY;
  try {
    await deps.ready(item, s.userId);
    return READY;
  } catch (e) {
    // Getting ready was told to wait (a sign-in limit): nothing was sent; hold the place and this row until then.
    const wait = deps.refused(e) ? waitSeconds(e) : undefined;
    if (wait !== undefined && wait <= MAX_WAIT_SECONDS) {
      const until = new Date(s.now().getTime() + withJitter(wait) * 1000);
      if (s.cool) await s.cool.cooldowns.note(s.cool.key, until).catch(() => {});
      return holdUntil(s, until);
    }
    if (deps.refused(e)) return fail(deps, s.userId, s.postId, item, wait !== undefined ? tooLongWait(item.kind) : message(e));
    // Nothing was sent: the row stays claimed and the next run after the claim takes it again.
    console.error(JSON.stringify({ event: "qp-direct-post-not-ready", userId: s.userId, postId: s.postId, kind: item.kind, message: forLog(e) }));
    return null;
  }
}

/** Records how a failed call ended: a wait, a refusal, or no answer (which may have landed and is never resent). */
async function afterCallFailed(s: Sending, e: unknown, scheduled: boolean, followsBuffer: boolean): Promise<DirectPostResult> {
  const { deps, item, userId, postId, now } = s;
  const refused = deps.refused(e);
  const wait = waitSeconds(e);
  const finish = async (result: { status: DirectPostStatus; link: string | null; error: string | null }) => {
    await deps.store.finish(userId, postId, item, result, now());
    return resultFor(item, result);
  };
  // Every "wait" holds the whole place, so other posts to it make no call until it ends. The network names the time
  // (any Mastodon server can send any reset), so the hold is capped and a longer wait fails the post instead.
  if (refused && wait !== undefined && s.cool) {
    const until = new Date(now().getTime() + Math.min(withJitter(wait), MAX_WAIT_SECONDS) * 1000);
    await s.cool.cooldowns.note(s.cool.cooldowns.wider?.(s.cool.key, e) ?? s.cool.key, until).catch(() => {});
  }
  if (refused && wait !== undefined && wait > MAX_WAIT_SECONDS) return finish({ status: "failed", link: null, error: tooLongWait(item.kind) });
  if (refused && scheduled && wait !== undefined) {
    // Rate limited: Telegram or Discord said wait, so nothing was posted. Try again after that.
    if (await deps.store.retryLater(userId, postId, item, new Date(now().getTime() + withJitter(wait) * 1000), now())) return waiting(item);
    // A follow-up is never resent from here (it is changed on its Buffer draft), so its message does not offer that.
    return finish({ status: "failed", link: null, error: `${PLACE_NAME[item.kind]} asked to wait ${WAIT_CEILING} times in a row, so this was not sent.${followsBuffer ? "" : " Send it again when you are ready."}` });
  }
  if (refused) return finish({ status: "failed", link: null, error: message(e) });
  console.error(JSON.stringify({ event: "qp-direct-post-uncertain", userId, postId, kind: item.kind, message: forLog(e) }));
  return finish({ status: "uncertain", link: null, error: UNSURE });
}

/**
 * Sends one claimed row. A refusal fails it, with the reason; a rate limit on a scheduled row waits and tries again;
 * anything else after the call started may have landed, so it is "uncertain" and never resent.
 */
async function deliver(userId: string, postId: string, item: PostItem, deps: DirectPostDeps, createdAt: Date, scheduled = false, followsBuffer = false): Promise<DirectPostResult | null> {
  const now = deps.now ?? (() => new Date());
  // The place is cooling down after a "wait": no call at all, not even getting ready (a Bluesky sign-in is a call).
  const { cooldowns } = deps;
  const coolKey = cooldowns ? await cooldowns.key(item, userId).catch(() => null) : null;
  const s: Sending = { userId, postId, item, deps, now, cool: cooldowns && coolKey ? { cooldowns, key: coolKey } : null };
  if (s.cool) {
    const until = await coolingUntil(s.cool, now);
    if (until) return holdUntil(s, until);
  }
  const ready = await getReady(s);
  if (ready !== READY) return ready;
  if (!(await deps.store.startCall(userId, postId, item, now()))) return null;
  let link: string | null;
  try {
    link = (await deps.post(item, userId, { postId, createdAt })).link;
  } catch (e) {
    return afterCallFailed(s, e, scheduled, followsBuffer);
  }
  const result = { status: "sent" as const, link, error: null };
  await deps.store.finish(userId, postId, item, result, now());
  return resultFor(item, result);
}

/** Checks the places of one post: at least one, and one message per kind. */
function checkItems(items: PostItem[]): void {
  if (!items.length) throw new Error("Choose at least one place to send it.");
  const places = items.map((i) => (ONE_PER_POST.has(i.kind) ? i.kind : `${i.kind}|${i.target}`));
  if (new Set(places).size !== items.length) throw new Error("Each place can get one message.");
}

/** How a stored row reads as a result now. */
function toResult(row: DirectPostRow, now: Date): DirectPostResult {
  return { kind: row.kind, target: row.target, label: row.label, status: shownStatus(row, now), link: row.link, error: row.error };
}

/**
 * The stored id for one composed post: the form's key bound to the person, so two people can never share a row and
 * the browser can never name someone else's. The "qp-announcement" prefix is the original one and must not change: a
 * form submitted to an older server and retried against a newer one has to land on the same id.
 */
export async function postIdFor(userId: string, key: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`qp-announcement|${userId}|${key}`));
  return Buffer.from(digest).toString("base64url");
}

/**
 * Sends one post to each chosen destination, one after the other. The key comes from the form and stays the
 * same for every submit of it, so a double click, a second tab or a retry after a dropped connection sends nothing
 * new and returns what was recorded. A new post, even with the same text, gets a new key.
 *
 * @param userId - The signed-in person; every row is scoped to them
 * @param key - The form's own id for this post
 * @param items - At most one per destination kind, each with its exact text
 * @returns The post id and one result per destination: sent now, or as recorded earlier
 * @throws Error when two items name the same destination kind or none is given
 */
export async function sendDirectPost(userId: string, key: string, items: PostItem[], deps: DirectPostDeps): Promise<{ postId: string; results: DirectPostResult[] }> {
  checkItems(items);
  const now = deps.now ?? (() => new Date());
  const postId = await postIdFor(userId, key);
  const results: DirectPostResult[] = [];
  for (const item of items) {
    const at = now();
    if (await deps.store.claim(userId, postId, item, at)) {
      const r = await deliver(userId, postId, item, deps, at);
      if (r) { results.push(r); continue; }
    }
    const row = (await deps.store.rows(userId, postId)).find((r) => r.kind === item.kind);
    if (row) results.push(toResult(row, now()));
  }
  return { postId, results };
}

/**
 * Sends a destination again after Telegram or Discord refused it, with the same text. A sent or uncertain
 * destination is never resent.
 *
 * @returns The new result, or null when there was nothing failed to resend
 */
export async function resendFailed(userId: string, postId: string, place: Place, deps: DirectPostDeps): Promise<DirectPostResult | null> {
  const now = deps.now ?? (() => new Date());
  const row = await deps.store.reclaimFailed(userId, postId, place, now());
  if (!row) return null;
  return deliver(userId, postId, { kind: row.kind, target: row.target, label: row.label, text: row.text, guildId: row.guildId }, deps, row.createdAt);
}

/**
 * Checks a requested send time: in the future and at most 60 days ahead.
 *
 * @returns null when fine, else the reason to show
 */
export function sendTimeProblem(sendAt: Date, now: Date): string | null {
  if (Number.isNaN(sendAt.getTime())) return "Pick a date and time.";
  if (sendAt.getTime() <= now.getTime() + 30_000) return "Pick a time in the future.";
  if (sendAt.getTime() - now.getTime() > MAX_AHEAD_MS) return "Pick a time within the next 60 days.";
  return null;
}

/**
 * Stores a post to go out at sendAt, one row per destination. The form's key makes a repeated submit a no-op that
 * returns what was stored.
 *
 * @returns The post id, its revision (for the timer) and one result per destination
 * @throws Error when no destination is given, two name the same kind, or the time is not allowed
 */
export async function scheduleDirectPost(userId: string, key: string, items: PostItem[], sendAt: Date, deps: DirectPostDeps): Promise<{ postId: string; revision: number; results: DirectPostResult[] }> {
  checkItems(items);
  const now = deps.now ?? (() => new Date());
  const problem = sendTimeProblem(sendAt, now());
  if (problem) throw new Error(problem);
  const postId = await postIdFor(userId, key);
  for (const item of items) await deps.store.schedule(userId, postId, item, sendAt, now());
  const rows = await deps.store.rows(userId, postId);
  return {
    postId,
    revision: Math.max(0, ...rows.map((r) => r.revision)),
    results: rows.map((r) => toResult(r, now())),
  };
}

/**
 * When to look again at a Buffer post that is not out yet. Moved later in Buffer: at its new time plus a minute.
 * Otherwise every 5 minutes for the first 2 hours past the place's time, then hourly. A day past that time, whatever
 * Buffer says or if Buffer cannot be read, never: it is marked not sent.
 *
 * @param sendAt - The place's own time (its Buffer post's time plus a minute); it does not move while waiting
 * @returns The next check (`move` when the place's time changes to it), or null to give up
 */
export function nextBufferCheck(state: BufferState, now: Date, sendAt: Date): { at: Date; move: boolean } | null {
  const due = state.state === "waiting" ? state.dueAt?.getTime() : undefined;
  if (due && due + 60_000 > sendAt.getTime() && due > now.getTime()) return { at: new Date(due + 60_000), move: true };
  const late = now.getTime() - sendAt.getTime();
  if (late > 24 * 3_600_000) return null;
  return { at: new Date(now.getTime() + (late < 2 * 3_600_000 ? 5 * 60_000 : 3_600_000)), move: false };
}

/**
 * After fresh Buffer data: follow-ups whose post now has a different time are moved to that time plus a minute (each
 * move is a new revision, so the old timer sends nothing).
 *
 * @returns The follow-ups moved, with the revision and time a new timer should use
 */
export async function retimeFollowUps(userId: string, posts: { id: string; status: string; dueAt: string | null }[], store: DirectPostStore, now: Date): Promise<{ postId: string; revision: number; sendAt: Date }[]> {
  const byId = new Map(posts.flatMap((p) => (p.dueAt && p.status !== "sent" ? [[p.id, Date.parse(p.dueAt) + 60_000] as const] : [])));
  if (!byId.size) return [];
  const waiting = await store.waitingFollowUps(userId, [...byId.keys()]);
  const moved = new Map<string, number>();
  for (const r of waiting) {
    const want = r.bufferPostId ? byId.get(r.bufferPostId) : undefined;
    if (want === undefined || !r.sendAt || Math.abs(r.sendAt.getTime() - want) < 30_000 || want <= now.getTime()) continue;
    moved.set(r.postId, want);
  }
  const out: { postId: string; revision: number; sendAt: Date }[] = [];
  for (const [postId, want] of moved) {
    const rows = await store.reschedule(userId, postId, { sendAt: new Date(want) }, now);
    if (rows.length) out.push({ postId, revision: Math.max(...rows.map((r) => r.revision)), sendAt: new Date(want) });
  }
  return out;
}

/** The id of the follow-up for one Buffer post: one per person and post, so ticking places again edits it. */
export function followUpIdFor(userId: string, bufferPostId: string): Promise<string> {
  return postIdFor(userId, `buffer:${bufferPostId}`);
}

/** A follow-up whose Buffer post has not gone out: failed when it never will, else checked again later. */
async function notYetInBuffer(deps: DirectPostDeps, row: DueRow, state: Exclude<BufferState, { state: "sent" }>, now: () => Date): Promise<DirectPostResult & { userId: string; postId: string; next?: Date }> {
  const tag = { userId: row.userId, postId: row.postId };
  const next = state.state === "gone" ? null : nextBufferCheck(state, now(), row.sendAt ?? now());
  if (!next) {
    const error = state.state === "gone" ? state.reason : "Buffer had not published the post a day after its time, so this was not sent.";
    return { ...(await fail(deps, row.userId, row.postId, row, error)), ...tag };
  }
  await deps.store.defer(row.userId, row.postId, row, next.move ? { sendAt: next.at } : { holdUntil: next.at }, now());
  return { kind: row.kind, target: row.target, label: row.label, status: "scheduled", link: null, error: null, ...tag, next: next.at };
}

/**
 * Sends everything that is due: scheduled posts whose time has come, and claims a dead worker left before calling
 * Telegram or Discord. Each destination is sent at most once, whatever runs at the same time. With `only`, just that
 * post at that revision, so a timer set before an edit or a cancel sends nothing.
 *
 * @returns One result per destination this run handled
 */
export async function runDue(deps: DirectPostDeps, opts: { limit?: number; only?: { postId: string; revision: number }; deadline?: Date } = {}): Promise<(DirectPostResult & { userId: string; postId: string; next?: Date })[]> {
  const now = deps.now ?? (() => new Date());
  const due = await deps.store.claimDue(now(), opts.limit ?? 25, opts.only);
  const out: (DirectPostResult & { userId: string; postId: string; next?: Date })[] = [];
  // One Buffer read per person for all their followed posts that are due, however many places follow each one.
  const reads = new Map<string, Promise<Map<string, BufferState>>>();
  const readBuffer = async (userId: string, bufferPostId: string): Promise<BufferState> => {
    let read = reads.get(userId);
    if (!read) {
      const ids = [...new Set(due.flatMap((d) => (d.userId === userId && d.bufferPostId ? [d.bufferPostId] : [])))];
      read = deps.bufferCheck
        ? deps.bufferCheck(userId, ids).catch((e) => {
            console.error(JSON.stringify({ event: "qp-follow-up-buffer-read-failed", userId, message: forLog(e) }));
            return new Map<string, BufferState>();
          })
        : Promise.resolve(new Map<string, BufferState>());
      reads.set(userId, read);
    }
    return (await read).get(bufferPostId) ?? { state: "busy" };
  };
  for (const [i, row] of due.entries()) {
    // Out of time: start no more sends, and give the rest back so the next run takes them without waiting for the claim.
    if (opts.deadline && now() >= opts.deadline) {
      for (const left of due.slice(i)) await deps.store.release(left.userId, left.postId, left, now()).catch(() => {});
      break;
    }
    const tag = { userId: row.userId, postId: row.postId };
    try {
      if (row.bufferPostId) {
        const state = await readBuffer(row.userId, row.bufferPostId);
        if (state.state !== "sent") {
          out.push(await notYetInBuffer(deps, row, state, now));
          continue;
        }
      }
      const r = await deliver(row.userId, row.postId, { kind: row.kind, target: row.target, label: row.label, text: row.text, guildId: row.guildId }, deps, row.createdAt, true, !!row.bufferPostId);
      if (r) out.push({ ...r, ...tag, ...(r.status === "scheduled" ? { next: new Date(now().getTime() + 60_000) } : {}) });
    } catch (e) {
      // One row's database error never stops the others; its claim runs out and the next run takes it again.
      console.error(JSON.stringify({ event: "qp-direct-post-run-failed", ...tag, kind: row.kind, message: forLog(e) }));
    }
  }
  return out;
}

/**
 * How a row reads now. A call that started and never finished reads "uncertain" after PENDING_MS. A claim that never
 * reached the call reads "pending": it will be sent.
 */
export function shownStatus(row: Pick<DirectPostRow, "status" | "updatedAt"> & Partial<Pick<DirectPostRow, "callStartedAt" | "claimedUntil">>, now: Date): DirectPostStatus {
  if (row.status !== "pending") return row.status;
  // A pending row with neither mark was written by an older server, which called right after claiming: treat it as a
  // started call, so it ages into "may have been sent" and is never sent again.
  const started = row.callStartedAt ?? (row.claimedUntil ? null : row.updatedAt);
  return started && now.getTime() - started.getTime() > PENDING_MS ? "uncertain" : "pending";
}

/** True when a post went out more than five minutes after its scheduled time. */
export function sentLate(row: Pick<DirectPostRow, "status" | "sendAt" | "callStartedAt">): boolean {
  return row.status === "sent" && !!row.sendAt && !!row.callStartedAt && row.callStartedAt.getTime() - row.sendAt.getTime() > 5 * 60_000;
}

/** An in-memory store for tests and the signed-out example; it lives in its own file. */
export { memoryDirectPostStore } from "./direct-posts-memory";
