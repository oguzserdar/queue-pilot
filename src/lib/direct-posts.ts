/**
 * Posts to Telegram and Discord on their own, with no Buffer post behind them: sent at once, or scheduled for a time.
 * Each destination is claimed before sending, so a double click, two tabs, two workers or a retry never post it twice.
 * A refusal from Telegram or Discord is "failed" and can be sent again by the person. The row is marked just before
 * the call to Telegram or Discord: a claim that never reached that point (the worker died first) is taken back and
 * sent later, while a call that got no answer is "uncertain", because it may have landed, and is never resent.
 */

export type PostKind = "telegram" | "discord";
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
export type ScheduleChange = { sendAt?: Date; texts?: Partial<Record<PostKind, string>> };

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
  unfollow(userId: string, postId: string, kind: PostKind, now: Date): Promise<void>;
  /**
   * Puts a claimed row back to wait, before any call was made (its Buffer post is not out yet): until `holdUntil`
   * with its time unchanged, or at a new `sendAt` when Buffer moved the post later.
   */
  defer(userId: string, postId: string, kind: PostKind, when: { sendAt?: Date; holdUntil?: Date }, now: Date): Promise<void>;
  /** After Telegram or Discord refused with "wait", the row waits until then and is sent again. */
  retryLater(userId: string, postId: string, kind: PostKind, until: Date, now: Date): Promise<void>;
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
  /**
   * Claims rows that are due: scheduled at or before now, or claimed earlier by a worker that died before calling
   * Telegram or Discord. With `only`, just that post, at that revision or older (a place added later than the
   * timer's revision waits for its own timer). Two workers never get the same row.
   */
  claimDue(now: Date, limit: number, only?: { postId: string; revision: number }): Promise<DueRow[]>;
  /** Marks a claimed row just before the call; false when it is no longer this run's to send. */
  startCall(userId: string, postId: string, kind: PostKind, now: Date): Promise<boolean>;
  /** This person's rows for one post, so a repeated submit returns what was recorded. */
  rows(userId: string, postId: string): Promise<DirectPostRow[]>;
  /** Claims a failed destination of a post of its own again for a resend (never a follow-up); the row, else null. */
  reclaimFailed(userId: string, postId: string, kind: PostKind, now: Date): Promise<DirectPostRow | null>;
  /** Records the result of a claimed row; a row no longer pending (taken over by another run) is left alone. */
  finish(userId: string, postId: string, kind: PostKind, result: { status: DirectPostStatus; link: string | null; error: string | null }, now: Date): Promise<void>;
  recent(userId: string, limit: number): Promise<DirectPostRow[]>;
};

export type DirectPostDeps = {
  store: DirectPostStore;
  /**
   * Checks, before any call, that the place can be posted to (still connected, bot set up). A refusal fails the row;
   * any other error leaves it claimed, so it is tried again once the claim runs out.
   */
  ready?: (item: PostItem, userId: string) => Promise<void>;
  /** Posts the exact text; returns a link to the message when the destination has one. */
  post: (item: PostItem, userId: string) => Promise<{ link: string | null }>;
  /** True when the destination answered with a refusal, so nothing was posted. */
  refused: (e: unknown) => boolean;
  /** Reads a person's followed Buffer posts at once, by id; without it, followed rows wait. Throws when Buffer cannot be read. */
  bufferCheck?: (userId: string, bufferPostIds: string[]) => Promise<Map<string, BufferState>>;
  now?: () => Date;
};

export type DirectPostResult = { kind: PostKind; label: string; status: DirectPostStatus; link: string | null; error: string | null };

/** A call older than this with no result is shown as "may have been sent". */
export const PENDING_MS = 2 * 60_000;
/** A claim not handed to Telegram or Discord within this time is taken back and sent again. */
export const CLAIM_MS = 2 * 60_000;
/** How far ahead a post can be scheduled. */
export const MAX_AHEAD_MS = 60 * 86_400_000;
const UNSURE = "No answer in time, so it may have been sent. Check the channel.";

/** How each kind of place is named to people. */
export const PLACE_NAME: Record<PostKind, string> = { telegram: "Telegram", discord: "Discord" };

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
/** Seconds Telegram or Discord asked us to wait, when the refusal was a rate limit. */
const waitSeconds = (e: unknown) => (e as { retryAfterSeconds?: number } | null)?.retryAfterSeconds;
/** An error for the logs: never post text, and a bot token in a request URL is masked. */
export const forLog = (e: unknown) => message(e).replace(/bot\d+:[\w-]+/g, "bot<token>").slice(0, 300);

/** Records a claimed row as not sent, with the reason, and returns that result. */
async function fail(deps: DirectPostDeps, userId: string, postId: string, item: Pick<PostItem, "kind" | "label">, error: string): Promise<DirectPostResult> {
  await deps.store.finish(userId, postId, item.kind, { status: "failed", link: null, error }, (deps.now ?? (() => new Date()))());
  return { kind: item.kind, label: item.label, status: "failed", link: null, error };
}

/**
 * Sends one claimed row. A refusal fails it, with the reason; a rate limit on a scheduled row waits and tries again;
 * anything else after the call started may have landed, so it is "uncertain" and never resent.
 */
async function deliver(userId: string, postId: string, item: PostItem, deps: DirectPostDeps, scheduled = false): Promise<DirectPostResult | null> {
  const now = deps.now ?? (() => new Date());
  if (deps.ready) {
    try {
      await deps.ready(item, userId);
    } catch (e) {
      if (deps.refused(e)) return fail(deps, userId, postId, item, message(e));
      // Nothing was sent: the row stays claimed and the next run after the claim takes it again.
      console.error(JSON.stringify({ event: "qp-direct-post-not-ready", userId, postId, kind: item.kind, message: forLog(e) }));
      return null;
    }
  }
  if (!(await deps.store.startCall(userId, postId, item.kind, now()))) return null;
  let result: { status: DirectPostStatus; link: string | null; error: string | null };
  try {
    result = { status: "sent", link: (await deps.post(item, userId)).link, error: null };
  } catch (e) {
    const refused = deps.refused(e);
    const wait = waitSeconds(e);
    if (refused && scheduled && wait !== undefined) {
      // Rate limited: Telegram or Discord said wait, so nothing was posted. Try again after that.
      await deps.store.retryLater(userId, postId, item.kind, new Date(now().getTime() + Math.max(1, wait) * 1000), now());
      return { kind: item.kind, label: item.label, status: "scheduled", link: null, error: null };
    }
    if (refused) result = { status: "failed", link: null, error: message(e) };
    else {
      console.error(JSON.stringify({ event: "qp-direct-post-uncertain", userId, postId, kind: item.kind, message: forLog(e) }));
      result = { status: "uncertain", link: null, error: UNSURE };
    }
  }
  await deps.store.finish(userId, postId, item.kind, result, now());
  return { kind: item.kind, label: item.label, ...result };
}

/** Checks the places of one post: at least one, and one message per kind. */
function checkItems(items: PostItem[]): void {
  if (!items.length) throw new Error("Choose at least one place to send it.");
  if (new Set(items.map((i) => i.kind)).size !== items.length) throw new Error("Each place can get one message.");
}

/** How a stored row reads as a result now. */
function toResult(row: DirectPostRow, now: Date): DirectPostResult {
  return { kind: row.kind, label: row.label, status: shownStatus(row, now), link: row.link, error: row.error };
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
    if (await deps.store.claim(userId, postId, item, now())) {
      const r = await deliver(userId, postId, item, deps);
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
export async function resendFailed(userId: string, postId: string, kind: PostKind, deps: DirectPostDeps): Promise<DirectPostResult | null> {
  const now = deps.now ?? (() => new Date());
  const row = await deps.store.reclaimFailed(userId, postId, kind, now());
  if (!row) return null;
  return deliver(userId, postId, { kind: row.kind, target: row.target, label: row.label, text: row.text, guildId: row.guildId }, deps);
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
  const byId = new Map(posts.filter((p) => p.dueAt && p.status !== "sent").map((p) => [p.id, Date.parse(p.dueAt!) + 60_000]));
  if (!byId.size) return [];
  const waiting = await store.waitingFollowUps(userId, [...byId.keys()]);
  const moved = new Map<string, number>();
  for (const r of waiting) {
    const want = byId.get(r.bufferPostId!);
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

/**
 * Sends everything that is due: scheduled posts whose time has come, and claims a dead worker left before calling
 * Telegram or Discord. Each destination is sent at most once, whatever runs at the same time. With `only`, just that
 * post at that revision, so a timer set before an edit or a cancel sends nothing.
 *
 * @returns One result per destination this run handled
 */
export async function runDue(deps: DirectPostDeps, opts: { limit?: number; only?: { postId: string; revision: number } } = {}): Promise<(DirectPostResult & { userId: string; postId: string; next?: Date })[]> {
  const now = deps.now ?? (() => new Date());
  const due = await deps.store.claimDue(now(), opts.limit ?? 25, opts.only);
  const out: (DirectPostResult & { userId: string; postId: string; next?: Date })[] = [];
  // One Buffer read per person for all their followed posts that are due, however many places follow each one.
  const reads = new Map<string, Promise<Map<string, BufferState>>>();
  const readBuffer = async (row: DueRow): Promise<BufferState> => {
    let read = reads.get(row.userId);
    if (!read) {
      const ids = [...new Set(due.filter((d) => d.userId === row.userId && d.bufferPostId).map((d) => d.bufferPostId!))];
      read = deps.bufferCheck
        ? deps.bufferCheck(row.userId, ids).catch((e) => {
            console.error(JSON.stringify({ event: "qp-follow-up-buffer-read-failed", userId: row.userId, message: forLog(e) }));
            return new Map<string, BufferState>();
          })
        : Promise.resolve(new Map<string, BufferState>());
      reads.set(row.userId, read);
    }
    return (await read).get(row.bufferPostId!) ?? { state: "busy" };
  };
  for (const row of due) {
    const tag = { userId: row.userId, postId: row.postId };
    try {
      if (row.bufferPostId) {
        const state = await readBuffer(row);
        if (state.state !== "sent") {
          const next = state.state === "gone" ? null : nextBufferCheck(state, now(), row.sendAt ?? now());
          if (!next) {
            const error = state.state === "gone" ? state.reason : "Buffer had not published the post a day after its time, so this was not sent.";
            out.push({ ...(await fail(deps, row.userId, row.postId, row, error)), ...tag });
          } else {
            await deps.store.defer(row.userId, row.postId, row.kind, next.move ? { sendAt: next.at } : { holdUntil: next.at }, now());
            out.push({ kind: row.kind, label: row.label, status: "scheduled", link: null, error: null, ...tag, next: next.at });
          }
          continue;
        }
      }
      const r = await deliver(row.userId, row.postId, { kind: row.kind, target: row.target, label: row.label, text: row.text, guildId: row.guildId }, deps, true);
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

/** An in-memory store for tests and the signed-out example. */
export function memoryDirectPostStore(): DirectPostStore {
  type Mem = DirectPostRow & { userId: string; claimedUntil: Date | null };
  const rows = new Map<string, Mem>();
  const key = (a: string, k: PostKind) => `${a}|${k}`;
  const base = (userId: string, postId: string, item: PostItem, now: Date): Mem => ({
    ...item, guildId: item.guildId ?? null, userId, postId, status: "pending", attempts: 1, link: null, error: null, sendAt: null, revision: 0,
    claimedUntil: new Date(now.getTime() + CLAIM_MS), callStartedAt: null, bufferPostId: null, createdAt: now, updatedAt: now,
  });
  const out = ({ userId: _u, ...r }: Mem): DirectPostRow => ({ ...r });
  return {
    async claim(userId, postId, item, now) {
      if (rows.has(key(postId, item.kind))) return false;
      rows.set(key(postId, item.kind), base(userId, postId, item, now));
      return true;
    },
    async schedule(userId, postId, item, sendAt, now, bufferPostId) {
      if (rows.has(key(postId, item.kind))) return false;
      rows.set(key(postId, item.kind), { ...base(userId, postId, item, now), status: "scheduled", sendAt, claimedUntil: null, bufferPostId: bufferPostId ?? null });
      return true;
    },
    async follow(userId, postId, item, sendAt, now, bufferPostId) {
      const r = rows.get(key(postId, item.kind));
      if (!r) { rows.set(key(postId, item.kind), { ...base(userId, postId, item, now), status: "scheduled", sendAt, claimedUntil: null, bufferPostId }); return true; }
      if (r.userId !== userId || (r.status !== "scheduled" && r.status !== "cancelled")) return false;
      Object.assign(r, { ...item, guildId: item.guildId ?? null, status: "scheduled", sendAt, revision: r.revision + 1, claimedUntil: null, callStartedAt: null, updatedAt: now });
      return true;
    },
    async unfollow(userId, postId, kind, now) {
      const r = rows.get(key(postId, kind));
      if (r && r.userId === userId && r.status === "scheduled") Object.assign(r, { status: "cancelled", revision: r.revision + 1, updatedAt: now });
    },
    async defer(userId, postId, kind, when, now) {
      const r = rows.get(key(postId, kind));
      if (r && r.userId === userId && r.status === "pending" && !r.callStartedAt) Object.assign(r, { status: "scheduled", ...(when.sendAt ? { sendAt: when.sendAt } : {}), claimedUntil: when.holdUntil ?? null, updatedAt: now });
    },
    async retryLater(userId, postId, kind, until, now) {
      const r = rows.get(key(postId, kind));
      if (r && r.userId === userId && r.status === "pending") Object.assign(r, { status: "scheduled", claimedUntil: until, callStartedAt: null, updatedAt: now });
    },
    async waitingFollowUps(userId, bufferPostIds) {
      const want = new Set(bufferPostIds);
      return [...rows.values()].filter((r) => r.userId === userId && r.bufferPostId && want.has(r.bufferPostId) && r.status === "scheduled").map(out);
    },
    async followedPlaces(userId, bufferPostIds) {
      const want = new Set(bufferPostIds);
      return new Set([...rows.values()]
        .filter((r) => r.userId === userId && r.bufferPostId && want.has(r.bufferPostId) && r.status !== "cancelled" && !(r.status === "failed" && !r.callStartedAt))
        .map((r) => `${r.bufferPostId}|${r.kind}`));
    },
    async reschedule(userId, postId, change, now) {
      const mine = [...rows.values()].filter((r) => r.userId === userId && r.postId === postId && r.status === "scheduled");
      for (const r of mine) {
        if (change.sendAt) { r.sendAt = change.sendAt; r.claimedUntil = null; }
        const t = change.texts?.[r.kind];
        if (t !== undefined) r.text = t;
        r.revision += 1;
        r.updatedAt = now;
      }
      return mine.map(out);
    },
    async cancel(userId, postId, now) {
      const mine = [...rows.values()].filter((r) => r.userId === userId && r.postId === postId && r.status === "scheduled");
      for (const r of mine) Object.assign(r, { status: "cancelled", revision: r.revision + 1, updatedAt: now });
      return mine.length;
    },
    async claimDue(now, limit, only) {
      const due = [...rows.values()].filter((r) =>
        (!only || (r.postId === only.postId && r.revision <= only.revision)) &&
        ((r.status === "scheduled" && r.sendAt && r.sendAt <= now && (!r.claimedUntil || r.claimedUntil <= now)) || (r.status === "pending" && !r.callStartedAt && r.claimedUntil && r.claimedUntil < now)),
      ).sort((a, b) => (a.sendAt?.getTime() ?? 0) - (b.sendAt?.getTime() ?? 0)).slice(0, limit);
      for (const r of due) Object.assign(r, { status: "pending", claimedUntil: new Date(now.getTime() + CLAIM_MS), updatedAt: now });
      return due.map((r) => ({ ...out(r), userId: r.userId }));
    },
    async startCall(userId, postId, kind, now) {
      const r = rows.get(key(postId, kind));
      if (!r || r.userId !== userId || r.status !== "pending" || r.callStartedAt) return false;
      Object.assign(r, { callStartedAt: now, updatedAt: now });
      return true;
    },
    async rows(userId, postId) {
      return [...rows.values()].filter((r) => r.userId === userId && r.postId === postId).map(out);
    },
    async reclaimFailed(userId, postId, kind, now) {
      const r = rows.get(key(postId, kind));
      if (!r || r.userId !== userId || r.status !== "failed" || r.bufferPostId) return null;
      Object.assign(r, { status: "pending", attempts: r.attempts + 1, callStartedAt: null, claimedUntil: new Date(now.getTime() + CLAIM_MS), updatedAt: now });
      return out(r);
    },
    async finish(userId, postId, kind, result, now) {
      const r = rows.get(key(postId, kind));
      if (r && r.userId === userId && r.status === "pending") Object.assign(r, result, { updatedAt: now });
    },
    async recent(userId, limit) {
      return [...rows.values()].filter((r) => r.userId === userId).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, limit).map(out);
    },
  };
}
