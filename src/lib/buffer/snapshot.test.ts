import { describe, expect, it, vi } from "vitest";
import type { bufferQuery } from "./client";
import { MIN_FORCED_REFRESH_MS, MIN_REFRESH_MS, SnapshotBusyError, memorySnapshotStore, refreshSnapshot } from "./snapshot";

const NOW = new Date("2026-10-26T09:00:00Z");

/** A fake Buffer that answers the three queries a refresh makes and reports one RateLimit window. */
function fakeBuffer() {
  const calls: string[] = [];
  const query = vi.fn(async (_t: string, text: string, _v?: unknown, opts?: { onRateLimit?: (w: unknown) => void }) => {
    opts?.onRateLimit?.([{ policy: "250-in-24h", remaining: 200, resetSeconds: 3600 }]);
    if (text.includes("account")) { calls.push("account"); return { account: { email: "a@b.co", organizations: [{ id: "o1" }] } }; }
    if (text.includes("channels")) { calls.push("channels"); return { channels: [{ id: "c1", name: "X" }] }; }
    calls.push("posts");
    return { posts: { edges: [{ node: { id: "p1", channelId: "c1" } }], pageInfo: { hasNextPage: false, endCursor: null } } };
  }) as unknown as typeof bufferQuery;
  return { query, calls };
}

describe("refreshSnapshot", () => {
  it("reads Buffer once, stores the copy, and records the RateLimit windows", async () => {
    const store = memorySnapshotStore();
    const { query, calls } = fakeBuffer();
    const snap = await refreshSnapshot("u1", "tok", { store, query, now: () => NOW });
    expect(calls.sort()).toEqual(["account", "channels", "posts"]);
    expect(snap?.data.posts).toHaveLength(1);
    expect(snap?.rateLimit[0]).toMatchObject({ remaining: 200 });
    expect(await store.get("u1")).toEqual(snap);
  });

  it("reuses a copy younger than MIN_REFRESH_MS without calling Buffer", async () => {
    const store = memorySnapshotStore();
    const first = fakeBuffer();
    await refreshSnapshot("u1", "tok", { store, query: first.query, now: () => NOW });
    const second = fakeBuffer();
    await refreshSnapshot("u1", "tok", { store, query: second.query, now: () => new Date(NOW.getTime() + MIN_REFRESH_MS - 1) });
    expect(second.calls).toEqual([]);
  });

  it("refreshes a young copy when forced (after our own write)", async () => {
    const store = memorySnapshotStore();
    await refreshSnapshot("u1", "tok", { store, query: fakeBuffer().query, now: () => NOW });
    const again = fakeBuffer();
    await refreshSnapshot("u1", "tok", { store, query: again.query, now: () => new Date(NOW.getTime() + MIN_FORCED_REFRESH_MS) }, { force: true });
    expect(again.calls.length).toBe(3);
  });

  it("ignores a forced refresh when the copy is under 30 seconds old (repeated Refresh clicks)", async () => {
    const store = memorySnapshotStore();
    await refreshSnapshot("u1", "tok", { store, query: fakeBuffer().query, now: () => NOW });
    const clicks = fakeBuffer();
    await refreshSnapshot("u1", "tok", { store, query: clicks.query, now: () => new Date(NOW.getTime() + MIN_FORCED_REFRESH_MS - 1) }, { force: true });
    expect(clicks.calls).toEqual([]);
  });

  it("shares one refresh between concurrent callers (two tabs cost one set of calls)", async () => {
    const store = memorySnapshotStore();
    const { query, calls } = fakeBuffer();
    const [a, b] = await Promise.all([
      refreshSnapshot("u1", "tok", { store, query, now: () => NOW }),
      refreshSnapshot("u1", "tok", { store, query, now: () => NOW }),
    ]);
    expect(a).toBe(b);
    expect(calls.length).toBe(3);
  });

  it("returns the existing copy when another instance holds the claim", async () => {
    const store = memorySnapshotStore();
    await refreshSnapshot("u1", "tok", { store, query: fakeBuffer().query, now: () => NOW });
    const later = new Date(NOW.getTime() + MIN_REFRESH_MS + 1);
    await store.claim("u1", later, new Date(later.getTime() + 60_000));
    const blocked = fakeBuffer();
    const snap = await refreshSnapshot("u1", "tok", { store, query: blocked.query, now: () => later });
    expect(blocked.calls).toEqual([]);
    expect(snap?.fetchedAt).toEqual(NOW);
  });

  it("releases the claim when Buffer fails, so the next refresh can run", async () => {
    const store = memorySnapshotStore();
    const failing = vi.fn(async () => { throw new Error("Buffer down"); }) as unknown as typeof bufferQuery;
    await expect(refreshSnapshot("u1", "tok", { store, query: failing, now: () => NOW })).rejects.toThrow("Buffer down");
    expect(await store.claim("u1", NOW, new Date(NOW.getTime() + 1000))).toBe(true);
  });
});

describe("withScheduled", () => {
  it("marks only the confirmed posts as scheduled and keeps everything else", async () => {
    const { withScheduled } = await import("./snapshot");
    const snap = {
      fetchedAt: new Date("2026-11-01T00:00:00Z"),
      rateLimit: [],
      data: { email: "a@b.c", organizationIds: ["o"], channels: [], truncated: false, range: { start: "s", end: "e" },
        posts: [
          { id: "a", channelId: "x", status: "draft" as const, text: "", dueAt: null, sentAt: null, externalLink: null, error: null },
          { id: "b", channelId: "x", status: "draft" as const, text: "", dueAt: null, sentAt: null, externalLink: null, error: null },
        ] },
    };
    const next = withScheduled(snap, ["a"]);
    expect(next.data.posts.map((p) => p.status)).toEqual(["scheduled", "draft"]);
    expect(next.fetchedAt).toBe(snap.fetchedAt);
    expect(snap.data.posts[0].status).toBe("draft");
  });
});

describe("withSavedDrafts", () => {
  it("makes just-drafted slots count as filled for openSlots, so they are not offered again", async () => {
    const { openSlots } = await import("../open-slots");
    const { withSavedDrafts } = await import("./snapshot");
    const channel = { id: "x", name: "X", service: "twitter", timezone: "UTC", isDisconnected: false, isLocked: false, isQueuePaused: false, organizationId: "o",
      postingSchedule: [{ day: "mon", paused: false, times: ["09:00"] }] } as any;
    const snap = { fetchedAt: new Date("2026-10-30T00:00:00Z"), rateLimit: [], data: { email: "e", organizationIds: ["o"], channels: [channel], posts: [] } } as any;
    const range = { start: new Date("2026-11-02T00:00:00Z"), end: new Date("2026-11-03T00:00:00Z") };
    const before = openSlots(snap.data.channels, snap.data.posts, range).slots;
    expect(before).toHaveLength(1);
    const after = withSavedDrafts(snap, [{ channelId: "x", at: before[0].at }]);
    expect(openSlots(after.data.channels, after.data.posts, range).slots).toEqual([]);
    // Marking the same slot twice adds it once.
    expect(withSavedDrafts(after, [{ channelId: "x", at: before[0].at }]).data.posts).toHaveLength(1);
  });
});

describe("refreshSnapshot for a write (force)", () => {
  it("does not settle for the old copy a page's refresh returned while the write was waiting", async () => {
    const store = memorySnapshotStore();
    await refreshSnapshot("u1", "tok", { store, query: fakeBuffer().query, now: () => NOW });
    const later = () => new Date(NOW.getTime() + MIN_REFRESH_MS - 1);
    const page = refreshSnapshot("u1", "tok", { store, query: fakeBuffer().query, now: later });
    const write = fakeBuffer();
    const snap = await refreshSnapshot("u1", "tok", { store, query: write.query, now: later }, { force: true });
    await page;
    expect(write.calls.length).toBe(3);
    expect(snap?.fetchedAt).toEqual(later());
  });

  it("waits for another instance's refresh instead of using an old copy", async () => {
    const store = memorySnapshotStore();
    await refreshSnapshot("u1", "tok", { store, query: fakeBuffer().query, now: () => NOW });
    const t = new Date(NOW.getTime() + 10 * 60_000);
    await store.claim("u1", t, new Date(t.getTime() + 60_000));
    const other = { data: (await store.get("u1"))!.data, fetchedAt: t, rateLimit: [] };
    let polls = 0;
    const sleep = async () => { if (++polls === 2) await store.save("u1", other); };
    const write = fakeBuffer();
    const snap = await refreshSnapshot("u1", "tok", { store, query: write.query, now: () => t, sleep }, { force: true });
    expect(snap?.fetchedAt).toEqual(t);
    expect(write.calls).toEqual([]);
  });

  it("says Buffer is busy when no fresh copy arrives, rather than writing on old data", async () => {
    const store = memorySnapshotStore();
    await refreshSnapshot("u1", "tok", { store, query: fakeBuffer().query, now: () => NOW });
    const t = new Date(NOW.getTime() + 10 * 60_000);
    await store.claim("u1", t, new Date(t.getTime() + 60_000));
    const err = await refreshSnapshot("u1", "tok", { store, query: fakeBuffer().query, now: () => t, sleep: async () => {} }, { force: true }).catch((e) => e);
    expect(err).toBeInstanceOf(SnapshotBusyError);
  });

  it("still returns the old copy to a page when another instance holds the refresh (control)", async () => {
    const store = memorySnapshotStore();
    await refreshSnapshot("u1", "tok", { store, query: fakeBuffer().query, now: () => NOW });
    const t = new Date(NOW.getTime() + 10 * 60_000);
    await store.claim("u1", t, new Date(t.getTime() + 60_000));
    const snap = await refreshSnapshot("u1", "tok", { store, query: fakeBuffer().query, now: () => t });
    expect(snap?.fetchedAt).toEqual(NOW);
  });
});

