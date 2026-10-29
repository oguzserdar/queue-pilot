import { describe, expect, it, vi } from "vitest";
import { listChannels, listPostsDue, type Post } from "./queries";

const post = (id: string): Post => ({ id, channelId: "c1", status: "scheduled", text: id, dueAt: "2026-11-02T09:00:00Z", sentAt: null, externalLink: null, error: null });
const page = (ids: string[], next: string | null) => ({
  posts: { edges: ids.map((id) => ({ node: post(id) })), pageInfo: { hasNextPage: next !== null, endCursor: next } },
});

describe("listPostsDue", () => {
  it("follows cursors until the last page", async () => {
    const q = vi.fn()
      .mockResolvedValueOnce(page(["p1", "p2"], "cur1"))
      .mockResolvedValueOnce(page(["p3"], null));
    const r = await listPostsDue("t", "org", { start: "2026-11-02T00:00:00Z", end: "2026-11-08T23:59:59Z" }, q);
    expect(r.posts.map((p) => p.id)).toEqual(["p1", "p2", "p3"]);
    expect(r.truncated).toBe(false);
    expect(q.mock.calls[1][2].after).toBe("cur1");
  });

  it("sends the date range as a dueAt filter, sorted by dueAt", async () => {
    const q = vi.fn().mockResolvedValueOnce(page([], null));
    await listPostsDue("t", "org", { start: "S", end: "E" }, q);
    expect(q.mock.calls[0][2].input).toEqual({ organizationId: "org", filter: { dueAt: { start: "S", end: "E" } }, sort: [{ field: "dueAt", direction: "asc" }] });
  });

  it("stops after the page limit and says so", async () => {
    let n = 0;
    const q = vi.fn(async () => page([`p${n++}`], `cur${n}`));
    const r = await listPostsDue("t", "org", { start: "S", end: "E" }, q as never);
    expect(q).toHaveBeenCalledTimes(10);
    expect(r.truncated).toBe(true);
  });
});

describe("listChannels", () => {
  it("asks for the posting schedule and channel health", async () => {
    const q = vi.fn().mockResolvedValueOnce({ channels: [] });
    await listChannels("t", "org", q);
    const query = q.mock.calls[0][1] as string;
    for (const f of ["postingSchedule { day paused times }", "timezone", "isDisconnected", "isLocked", "isQueuePaused"]) expect(query).toContain(f);
  });
});
