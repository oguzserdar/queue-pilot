/**
 * @fileoverview The in-memory direct post store, for tests and the signed-out example. It keeps the same rules as the
 * Postgres store (direct-post-store.ts): one row per place, claims that run out, and every change scoped to its owner.
 */
import { isPostingNetwork } from "./social-networks";
import { CLAIM_MS, ONE_PER_POST, WAIT_CEILING, textFor, type DirectPostRow, type DirectPostStore, type Place, type PostItem } from "./direct-posts";

type Mem = DirectPostRow & { userId: string; claimedUntil: Date | null };
type Rows = Map<string, Mem>;

const key = (a: string, p: Place) => (ONE_PER_POST.has(p.kind) ? `${a}|${p.kind}` : `${a}|${p.kind}|${p.target}`);
const base = (userId: string, postId: string, item: PostItem, now: Date): Mem => ({
  ...item, guildId: item.guildId ?? null, userId, postId, status: "pending", attempts: 1, waits: 0, link: null, error: null, sendAt: null, revision: 0,
  claimedUntil: new Date(now.getTime() + CLAIM_MS), callStartedAt: null, bufferPostId: null, createdAt: now, updatedAt: now,
});
const out = ({ userId: _u, ...r }: Mem): DirectPostRow => ({ ...r });

type Planning = Pick<DirectPostStore, "claim" | "schedule" | "follow" | "unfollow" | "defer" | "retryLater" | "waitingFollowUps" | "followedPlaces" | "reschedule" | "cancelKind" | "cancel">;

/** Writing, scheduling, following and cancelling rows. */
function planning(rows: Rows): Planning {
  return {
    async claim(userId, postId, item, now) {
      if (rows.has(key(postId, item))) return false;
      rows.set(key(postId, item), base(userId, postId, item, now));
      return true;
    },
    async schedule(userId, postId, item, sendAt, now, bufferPostId) {
      if (rows.has(key(postId, item))) return false;
      rows.set(key(postId, item), { ...base(userId, postId, item, now), status: "scheduled", sendAt, claimedUntil: null, bufferPostId: bufferPostId ?? null });
      return true;
    },
    async follow(userId, postId, item, sendAt, now, bufferPostId) {
      const r = rows.get(key(postId, item));
      if (!r) { rows.set(key(postId, item), { ...base(userId, postId, item, now), status: "scheduled", sendAt, claimedUntil: null, bufferPostId }); return true; }
      if (r.userId !== userId || (r.status !== "scheduled" && r.status !== "cancelled")) return false;
      Object.assign(r, { ...item, guildId: item.guildId ?? null, status: "scheduled", sendAt, revision: r.revision + 1, claimedUntil: null, callStartedAt: null, updatedAt: now });
      return true;
    },
    async unfollow(userId, postId, place, now) {
      const r = rows.get(key(postId, place));
      if (r && r.userId === userId && r.status === "scheduled") Object.assign(r, { status: "cancelled", revision: r.revision + 1, updatedAt: now });
    },
    async defer(userId, postId, place, when, now) {
      const r = rows.get(key(postId, place));
      if (r && r.userId === userId && r.status === "pending" && !r.callStartedAt) Object.assign(r, { status: "scheduled", ...(when.sendAt ? { sendAt: when.sendAt } : {}), claimedUntil: when.holdUntil ?? null, updatedAt: now });
    },
    async retryLater(userId, postId, place, until, now) {
      const r = rows.get(key(postId, place));
      // A "send now" post has no send time; without one the due check would never pick the retry up again.
      if (!r || r.userId !== userId || r.status !== "pending") return true;
      if (r.waits >= WAIT_CEILING) return false;
      Object.assign(r, { status: "scheduled", sendAt: r.sendAt ?? until, claimedUntil: until, callStartedAt: null, waits: r.waits + 1, updatedAt: now });
      return true;
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
        const t = textFor(change, r);
        if (t !== undefined) r.text = t;
        r.revision += 1;
        r.updatedAt = now;
      }
      return mine.map(out);
    },
    async cancelKind(userId, kind, now) {
      let n = 0;
      for (const r of rows.values()) if (r.userId === userId && r.kind === kind && (r.status === "scheduled" || (r.status === "pending" && !r.callStartedAt))) { Object.assign(r, { status: "cancelled", revision: r.revision + 1, updatedAt: now }); n++; }
      return n;
    },
    async cancel(userId, postId, now) {
      const mine = [...rows.values()].filter((r) => r.userId === userId && r.postId === postId && r.status === "scheduled");
      for (const r of mine) Object.assign(r, { status: "cancelled", revision: r.revision + 1, updatedAt: now });
      return mine.length;
    },
  };
}

/** Claiming due rows, sending them, and reading them back. */
function sending(rows: Rows): Omit<DirectPostStore, keyof Planning> {
  return {
    async claimDue(now, limit, only) {
      const due = [...rows.values()].filter((r) =>
        (!only || (r.postId === only.postId && r.revision <= only.revision)) &&
        ((r.status === "scheduled" && r.sendAt && r.sendAt <= now && (!r.claimedUntil || r.claimedUntil <= now)) || (r.status === "pending" && !r.callStartedAt && r.claimedUntil && r.claimedUntil < now)),
      ).sort((a, b) => (a.sendAt?.getTime() ?? 0) - (b.sendAt?.getTime() ?? 0)).slice(0, limit);
      for (const r of due) Object.assign(r, { status: "pending", claimedUntil: new Date(now.getTime() + CLAIM_MS), updatedAt: now });
      return due.map((r) => ({ ...out(r), userId: r.userId }));
    },
    async hold(userId, postId, place, until, now) {
      const r = rows.get(key(postId, place));
      if (r && r.userId === userId && r.status === "pending" && !r.callStartedAt) Object.assign(r, { status: "scheduled", sendAt: r.sendAt ?? until, claimedUntil: until, updatedAt: now });
    },
    async release(userId, postId, place, now) {
      const r = rows.get(key(postId, place));
      if (r && r.userId === userId && r.status === "pending" && !r.callStartedAt) Object.assign(r, { claimedUntil: new Date(now.getTime() - 1), updatedAt: now });
    },
    async startCall(userId, postId, place, now) {
      const r = rows.get(key(postId, place));
      if (!r || r.userId !== userId || r.status !== "pending" || r.callStartedAt) return false;
      Object.assign(r, { callStartedAt: now, updatedAt: now });
      return true;
    },
    async rows(userId, postId) {
      return [...rows.values()].filter((r) => r.userId === userId && r.postId === postId).map(out);
    },
    async reclaimFailed(userId, postId, place, now) {
      const r = rows.get(key(postId, place));
      if (!r || r.userId !== userId || r.status !== "failed" || r.bufferPostId) return null;
      Object.assign(r, { status: "pending", attempts: r.attempts + 1, waits: 0, callStartedAt: null, claimedUntil: new Date(now.getTime() + CLAIM_MS), updatedAt: now });
      return out(r);
    },
    async finish(userId, postId, place, result, now) {
      const r = rows.get(key(postId, place));
      if (r && r.userId === userId && r.status === "pending") Object.assign(r, result, { updatedAt: now });
    },
    async recent(userId, limit) {
      return [...rows.values()].filter((r) => r.userId === userId).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, limit).map(out);
    },
    async between(userId, start, end) {
      const at = (r: DirectPostRow) => (r.sendAt ?? r.createdAt).getTime();
      return [...rows.values()]
        .filter((r) => r.userId === userId && isPostingNetwork(r.kind) && r.status !== "cancelled" && at(r) >= start.getTime() && at(r) < end.getTime())
        .sort((a, b) => at(a) - at(b)).map(out);
    },
  };
}

/** An in-memory store for tests and the signed-out example. */
export function memoryDirectPostStore(): DirectPostStore {
  const rows: Rows = new Map();
  return { ...planning(rows), ...sending(rows) };
}
