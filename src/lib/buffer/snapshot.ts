/**
 * A per-user copy of the Buffer data the screens need, so a page view reads our database and makes no Buffer call.
 * Buffer allows 100 requests per 15 minutes and 250 to 500 per day (https://developers.buffer.com/guides/api-limits),
 * so the copy is refreshed only on purpose: at sign-in, from the Refresh button, by the slow background sync and after
 * our own writes. Each refresh records Buffer's RateLimit windows, so callers can slow down before a 429.
 *
 * One refresh per user at a time: concurrent callers in this process share one promise, and across server instances
 * a short claim on the row (refreshing_until) keeps a second instance from starting a parallel refresh.
 */
import { bufferQuery, type RateLimitWindow } from "./client";
import { getAccount, listChannels, listPostsDue, type Channel, type Post } from "./queries";

/** Posts from this many days ago (delivery check) to this many days ahead (next week plus margin). */
export const PAST_DAYS = 7;
export const FUTURE_DAYS = 14;
/** A refresh newer than this is reused instead of spending more requests. */
export const MIN_REFRESH_MS = 5 * 60_000;
/** Even a forced refresh (the Refresh button) reuses a copy this young, so repeated clicks cannot spend the limit. */
export const MIN_FORCED_REFRESH_MS = 30_000;
/** How long a refresh may hold its claim before another instance may take over. */
const CLAIM_MS = 60_000;
/** A write whose refresh another instance holds checks this often, this many times, for that instance's copy. */
const BUSY_WAIT_MS = 500;
const BUSY_WAIT_TRIES = 6;

/** A write could not get a fresh copy because another instance is still refreshing it. */
export class SnapshotBusyError extends Error {
  constructor() {
    super("Buffer is being read right now. Try again in a few seconds.");
    this.name = "SnapshotBusyError";
  }
}

export type SnapshotData = {
  email: string;
  /** The account's own timezone from Buffer. Absent in copies saved before it was read. */
  timezone?: string | null;
  organizationIds: string[];
  channels: Channel[];
  posts: Post[];
  /** True when one organization had more posts than one refresh reads; open slots stop at the last post read (knownRange). */
  truncated: boolean;
  range: { start: string; end: string };
};

export type Snapshot = { data: SnapshotData; fetchedAt: Date; rateLimit: RateLimitWindow[] };

/** Where snapshots live. Postgres in production (snapshot-store.ts); an in-memory store in tests. */
export type SnapshotStore = {
  get(userId: string): Promise<Snapshot | null>;
  /** Claims the refresh for this user until `until`; false when another refresh holds an unexpired claim. */
  claim(userId: string, now: Date, until: Date): Promise<boolean>;
  save(userId: string, snapshot: Snapshot): Promise<void>;
  release(userId: string): Promise<void>;
};

type Deps = { store: SnapshotStore; now?: () => Date; query?: typeof bufferQuery; sleep?: (ms: number) => Promise<void> };

const inFlight = new Map<string, Promise<Snapshot | null>>();

/** Reads everything the screens need from Buffer, recording the RateLimit windows seen on the way. */
async function fetchFromBuffer(token: string, now: Date, query: typeof bufferQuery): Promise<Snapshot> {
  let rateLimit: RateLimitWindow[] = [];
  const q: typeof bufferQuery = (t, text, variables, opts) =>
    query(t, text, variables, { ...opts, onRateLimit: (w) => { rateLimit = w; } });

  const range = {
    start: new Date(now.getTime() - PAST_DAYS * 86_400_000).toISOString(),
    end: new Date(now.getTime() + FUTURE_DAYS * 86_400_000).toISOString(),
  };
  const account = await getAccount(token, q);
  const [channels, postResults] = await Promise.all([
    Promise.all(account.organizationIds.map((id) => listChannels(token, id, q))).then((c) => c.flat()),
    Promise.all(account.organizationIds.map((id) => listPostsDue(token, id, range, q))),
  ]);
  return {
    data: {
      email: account.email,
      timezone: account.timezone,
      organizationIds: account.organizationIds,
      channels,
      posts: postResults.flatMap((r) => r.posts),
      truncated: postResults.some((r) => r.truncated),
      range,
    },
    fetchedAt: now,
    rateLimit,
  };
}

/**
 * Refreshes the user's snapshot from Buffer unless a recent one exists (unless `force`) or another refresh holds the claim.
 * Returns the newest snapshot available, which may be the existing one; null only when there has never been one.
 * A forced refresh is for writes, which must decide on current data: it never settles for a copy older than
 * MIN_FORCED_REFRESH_MS, and throws SnapshotBusyError rather than return one.
 */
export function refreshSnapshot(userId: string, token: string, deps: Deps, opts: { force?: boolean } = {}): Promise<Snapshot | null> {
  const running = inFlight.get(userId);
  if (!running) return start(userId, token, deps, opts);
  if (!opts.force) return running;
  // A page's refresh may return a copy up to MIN_REFRESH_MS old; a write waits for it, then refreshes again if needed.
  return running.catch(() => null).then((snap) => {
    const now = (deps.now ?? (() => new Date()))();
    if (snap && now.getTime() - snap.fetchedAt.getTime() < MIN_FORCED_REFRESH_MS) return snap;
    return start(userId, token, deps, opts);
  });
}

function start(userId: string, token: string, deps: Deps, opts: { force?: boolean }): Promise<Snapshot | null> {
  const promise = (async () => {
    const now = (deps.now ?? (() => new Date()))();
    const existing = await deps.store.get(userId);
    const age = existing ? now.getTime() - existing.fetchedAt.getTime() : Infinity;
    if (age < (opts.force ? MIN_FORCED_REFRESH_MS : MIN_REFRESH_MS)) return existing;
    if (!(await deps.store.claim(userId, now, new Date(now.getTime() + CLAIM_MS)))) {
      return opts.force ? awaitOtherInstance(userId, now, deps) : existing;
    }
    try {
      const fresh = await fetchFromBuffer(token, now, deps.query ?? bufferQuery);
      await deps.store.save(userId, fresh);
      return fresh;
    } finally {
      await deps.store.release(userId);
    }
  })();

  inFlight.set(userId, promise);
  promise.finally(() => { if (inFlight.get(userId) === promise) inFlight.delete(userId); }).catch(() => {});
  return promise;
}

/** Waits briefly for the copy another instance is refreshing, so a write never decides on old data. */
async function awaitOtherInstance(userId: string, now: Date, deps: Deps): Promise<Snapshot> {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  for (let i = 0; i < BUSY_WAIT_TRIES; i++) {
    await sleep(BUSY_WAIT_MS);
    const snap = await deps.store.get(userId);
    if (snap && now.getTime() - snap.fetchedAt.getTime() < MIN_FORCED_REFRESH_MS) return snap;
  }
  throw new SnapshotBusyError();
}

/** An in-memory store with the same claim rules as Postgres, for tests. */
export function memorySnapshotStore(): SnapshotStore {
  const rows = new Map<string, { snapshot: Snapshot | null; claimedUntil: number }>();
  return {
    async get(userId) { return rows.get(userId)?.snapshot ?? null; },
    async claim(userId, now, until) {
      const row = rows.get(userId) ?? { snapshot: null, claimedUntil: 0 };
      if (row.claimedUntil > now.getTime()) return false;
      rows.set(userId, { ...row, claimedUntil: until.getTime() });
      return true;
    },
    async save(userId, snapshot) {
      const row = rows.get(userId) ?? { snapshot: null, claimedUntil: 0 };
      rows.set(userId, { ...row, snapshot });
    },
    async release(userId) {
      const row = rows.get(userId);
      if (row) rows.set(userId, { ...row, claimedUntil: 0 });
    },
  };
}

/**
 * The snapshot after Buffer confirmed these posts as scheduled, so the screens show the approval at once without
 * spending another request. Everything else, including fetchedAt, is unchanged.
 */
export function withScheduled(snapshot: Snapshot, ids: string[]): Snapshot {
  const set = new Set(ids);
  return { ...snapshot, data: { ...snapshot.data, posts: snapshot.data.posts.map((p) => (set.has(p.id) ? { ...p, status: "scheduled" as const } : p)) } };
}

/**
 * Keeps saved drafts visible before the next Buffer read. A missing id gets a temporary placeholder.
 */
export function withSavedDrafts(snapshot: Snapshot, slots: { channelId: string, at: string, postId?: string | null, text?: string }[]): Snapshot {
  const added = slots.map((s) => ({
    id: s.postId ?? `pending:${s.channelId}@${s.at}`,
    channelId: s.channelId,
    status: "draft" as const,
    text: s.text ?? "",
    via: "api" as const,
    dueAt: s.at,
    sentAt: null,
    externalLink: null,
    error: null,
  }));
  const known = new Set(snapshot.data.posts.map((p) => p.id));
  return { ...snapshot, data: { ...snapshot.data, posts: [...snapshot.data.posts, ...added.filter((p) => !known.has(p.id))] } };
}
