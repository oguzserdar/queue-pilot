import { describe, expect, it } from "vitest";
import type { Channel, Post } from "./buffer/queries";
import { needsFromBuffer } from "./needs-model";

const NOW = new Date("2026-10-20T12:00:00Z"); // next week = Mon 26 Oct – Sun 1 Nov in Istanbul
const TZ = "Europe/Istanbul";
const channel = (over: Partial<Channel>): Channel => ({
  id: "c1", name: "X", service: "twitter", timezone: TZ, isDisconnected: false, isLocked: false, isQueuePaused: false,
  postingSchedule: [{ day: "mon", paused: false, times: ["09:00"] }, { day: "wed", paused: false, times: ["12:00", "18:30"] }],
  ...over,
});
const post = (over: Partial<Post>): Post => ({ id: "p", channelId: "c1", status: "scheduled", text: "t", dueAt: null, sentAt: null, externalLink: null, error: null, ...over });

const x = channel({});
const bluesky = channel({ id: "c2", name: "Bluesky", isDisconnected: true, postingSchedule: [{ day: "thu", paused: false, times: ["10:00"] }] });

describe("needsFromBuffer", () => {
  it("lists drafts, posts that would fail, posts that did not go out, and open slots, from real data only", () => {
    const posts = [
      post({ id: "d1", status: "draft", dueAt: "2026-10-26T06:00:00Z" }), // X Mon 09:00 Istanbul
      post({ id: "b1", channelId: "c2", dueAt: "2026-10-29T07:00:00Z" }), // Bluesky Thu 10:00, channel disconnected
      post({ id: "e1", status: "error", dueAt: "2026-10-16T06:00:00Z", error: { message: "The image could not be loaded from its link", supportUrl: null } }),
    ];
    const needs = needsFromBuffer([x, bluesky], posts, NOW, TZ);
    expect(needs.map((n) => [n.id, n.title])).toEqual([
      ["drafts", "1 draft to approve"],
      ["willfail", "1 post would fail"],
      ["failed", "1 post did not go out"],
      ["open", "2 empty slots next week"],
    ]);
    expect(needs[0].detail).toBe("Next week, on X");
    expect(needs[1].detail).toMatch(/Bluesky is disconnected/);
    expect(needs[2].detail).toMatch(/image could not be loaded/);
    expect(needs[3].detail).toMatch(/^2 of 4 filled/);
  });

  it("says next week is full when every slot holds a post", () => {
    const posts = ["2026-10-26T06:00:00Z", "2026-10-28T09:00:00Z", "2026-10-28T15:30:00Z"].map((dueAt, i) => post({ id: `s${i}`, dueAt }));
    const needs = needsFromBuffer([x], posts, NOW, TZ);
    expect(needs).toEqual([expect.objectContaining({ id: "filled", tone: "success", title: "Next week: all 3 slots have a post or draft" })]);
  });

  it("shows nothing when there are no slots and nothing went wrong", () => {
    expect(needsFromBuffer([channel({ postingSchedule: [] })], [], NOW, TZ)).toEqual([]);
  });
});
