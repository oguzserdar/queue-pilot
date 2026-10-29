import { describe, expect, it } from "vitest";
import type { Channel, Post } from "./buffer/queries";
import { deliveriesFromBuffer } from "./delivery-model";

const ch: Channel = { id: "c1", name: "X", service: "twitter", timezone: "UTC", isDisconnected: false, isLocked: false, isQueuePaused: false, postingSchedule: [] };
const post = (over: Partial<Post>): Post => ({ id: "p", channelId: "c1", status: "sent", text: "hello", dueAt: "2026-10-14T09:00:00Z", sentAt: null, externalLink: null, error: null, ...over });
const range = { start: new Date("2026-10-12T00:00:00Z"), end: new Date("2026-10-19T00:00:00Z") };
const now = new Date("2026-10-20T12:00:00Z");

describe("deliveriesFromBuffer", () => {
  it("marks sent, failed and late posts, oldest first", () => {
    const items = deliveriesFromBuffer([ch], [
      post({ id: "b", status: "error", dueAt: "2026-10-15T09:00:00Z", error: { message: "Image could not load", supportUrl: "https://support.example/x" } }),
      post({ id: "a", status: "sent", dueAt: "2026-10-13T09:00:00Z" }),
      post({ id: "c", status: "scheduled", dueAt: "2026-10-16T09:00:00Z" }),
    ], range, now);
    expect(items.map((i) => [i.id, i.tone])).toEqual([["a", "success"], ["b", "danger"], ["c", "warning"]]);
    expect(items[1].error).toEqual({ message: "Image could not load", supportUrl: "https://support.example/x" });
  });

  it("gives a post 15 minutes before calling it late", () => {
    const soon = new Date("2026-10-16T09:10:00Z");
    expect(deliveriesFromBuffer([ch], [post({ status: "scheduled", dueAt: "2026-10-16T09:00:00Z" })], range, soon)).toEqual([]);
  });

  it("skips drafts, posts outside the range and unknown channels; shortens long text", () => {
    const long = "x".repeat(100);
    const items = deliveriesFromBuffer([ch], [
      post({ id: "d", status: "draft" }),
      post({ id: "e", dueAt: "2026-10-01T09:00:00Z" }),
      post({ id: "f", channelId: "gone" }),
      post({ id: "g", text: long }),
    ], range, now);
    expect(items.map((i) => i.id)).toEqual(["g"]);
    expect(items[0].title.length).toBeLessThan(75);
  });
});
