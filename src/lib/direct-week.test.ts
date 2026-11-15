/**
 * @fileoverview Direct posts as week posts: one per account, on that account's channel, at its send time (or when it
 * was sent at once), with a refusal or an unknown outcome carried as the post's error.
 */
import { describe, expect, it } from "vitest";
import type { DirectPostRow } from "./direct-posts";
import { directWeekPosts } from "./direct-week";

const base: DirectPostRow = {
  postId: "p1", kind: "mastodon", target: "a1", label: "@ada", text: "Out now.", status: "scheduled", attempts: 0, waits: 0, link: null, error: null,
  sendAt: new Date("2026-11-16T09:00:00Z"), revision: 0, callStartedAt: null, claimedUntil: null, bufferPostId: null,
  createdAt: new Date("2026-11-15T10:00:00Z"), updatedAt: new Date("2026-11-15T10:00:00Z"),
};

describe("directWeekPosts", () => {
  it("puts a scheduled row on its account's channel at its send time", () => {
    expect(directWeekPosts([base])).toEqual([expect.objectContaining({ id: "p1|a1", channelId: "direct:a1", status: "scheduled", dueAt: "2026-11-16T09:00:00.000Z", text: "Out now.", via: "network" })]);
  });
  it("places a post sent at once at the moment it was made", () => {
    const [p] = directWeekPosts([{ ...base, sendAt: null, status: "sent", link: "https://m/1" }]);
    expect(p).toMatchObject({ status: "sent", dueAt: "2026-11-15T10:00:00.000Z", externalLink: "https://m/1" });
  });
  it("carries a refusal and an unknown outcome as errors", () => {
    expect(directWeekPosts([{ ...base, status: "failed", error: "Too long." }])[0].error?.message).toBe("Too long.");
    expect(directWeekPosts([{ ...base, status: "uncertain" }])[0].error?.message).toMatch(/may have been posted/);
  });
  it("gives each account of one post its own week post, and skips cancelled rows and bot places", () => {
    const rows = [base, { ...base, target: "a2" }, { ...base, target: "a3", status: "cancelled" as const }, { ...base, kind: "telegram" as const, target: "t1" }];
    expect(directWeekPosts(rows).map((p) => p.id)).toEqual(["p1|a1", "p1|a2"]);
  });
});
