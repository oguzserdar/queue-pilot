import { describe, expect, it } from "vitest";
import type { Post } from "./buffer/queries";
import { MAX_ATTEMPTS, imageOf, planEchoes, runEchoes, type Destination, type EchoRecord } from "./echo";

const now = new Date("2026-11-03T12:00:00Z");
const post = (over: Partial<Post>): Post => ({
  id: "p1",
  channelId: "x",
  status: "sent",
  text: "CSV export is live.",
  dueAt: "2026-11-03T09:00:00Z",
  sentAt: "2026-11-03T09:00:05Z",
  externalLink: "https://x.com/p/1",
  error: null,
  ...over,
});
const tg: Destination = { id: "tg1", kind: "telegram", label: "Pennyrow news" };
const dc: Destination = { id: "dc1", kind: "discord", label: "#announcements" };
const long = { tg1: new Date("2026-11-01T00:00:00Z"), dc1: new Date("2026-11-01T00:00:00Z") };

describe("planEchoes", () => {
  it("copies a sent post to every destination", () => {
    expect(planEchoes([post({})], [tg, dc], [], now, long).map((s) => s.destination.id)).toEqual(["tg1", "dc1"]);
  });

  it("never copies drafts, scheduled or failed posts", () => {
    const posts = [post({ id: "d", status: "draft", sentAt: null }), post({ id: "s", status: "scheduled", sentAt: null }), post({ id: "e", status: "error" })];
    expect(planEchoes(posts, [tg], [], now, long)).toEqual([]);
  });

  it("never sends the same copy twice", () => {
    const records: EchoRecord[] = [{ postId: "p1", destinationId: "tg1", status: "sent", attempts: 1, messageId: "55" }];
    expect(planEchoes([post({})], [tg, dc], records, now, long).map((s) => s.destination.id)).toEqual(["dc1"]);
  });

  it("retries a failed copy, then gives up after the last attempt", () => {
    const failed = (attempts: number): EchoRecord[] => [{ postId: "p1", destinationId: "tg1", status: "failed", attempts }];
    expect(planEchoes([post({})], [tg], failed(1), now, long)).toHaveLength(1);
    expect(planEchoes([post({})], [tg], failed(MAX_ATTEMPTS), now, long)).toEqual([]);
  });

  it("does not flood a newly connected channel with older posts", () => {
    const justNow = { tg1: new Date("2026-11-03T10:00:00Z") };
    expect(planEchoes([post({})], [tg], [], now, justNow)).toEqual([]);
  });

  it("copies a post sent 30 hours ago (the daily run may come late) but not one from more than two days ago", () => {
    const since = { tg1: new Date("2026-10-01T00:00:00Z") };
    expect(planEchoes([post({ sentAt: "2026-11-02T06:00:00Z" })], [tg], [], now, since)).toHaveLength(1);
    expect(planEchoes([post({ sentAt: "2026-11-01T09:00:00Z" })], [tg], [], now, since)).toEqual([]);
  });
});

describe("runEchoes", () => {
  it("records each copy, counting attempts, and keeps going after a failure", async () => {
    const recorded: EchoRecord[] = [];
    const plan = planEchoes([post({})], [tg, dc], [{ postId: "p1", destinationId: "dc1", status: "failed", attempts: 1 }], now, long);
    const out = await runEchoes(plan, {
      claim: async () => true,
      send: async (s) => {
        if (s.destination.kind === "telegram") throw new Error("Bad Request: chat not found");
        return { messageId: "m9" };
      },
      record: async (r) => void recorded.push(r),
      previous: (postId, destinationId) => (postId === "p1" && destinationId === "dc1" ? { postId, destinationId, status: "failed", attempts: 1 } : undefined),
    });
    expect(out).toEqual([
      { postId: "p1", destinationId: "tg1", status: "failed", attempts: 1, error: "Bad Request: chat not found" },
      { postId: "p1", destinationId: "dc1", status: "sent", attempts: 2, messageId: "m9" },
    ]);
    expect(recorded).toEqual(out);
  });
});

describe("reminder posts and images", () => {
  it("copies a reminder post only once the person marked it published", () => {
    expect(planEchoes([post({ schedulingType: "notification", notificationStatus: "notified" })], [tg], [], now, long)).toEqual([]);
    expect(planEchoes([post({ schedulingType: "notification", notificationStatus: "markedAsPublished" })], [tg], [], now, long)).toHaveLength(1);
  });

  it("uses the first https image, never a video or a document", () => {
    expect(imageOf(post({ assets: [{ type: "video", mimeType: "video/mp4", source: "https://v.example/a.mp4" }, { type: "image", mimeType: "image/png", source: "https://i.example/a.png" }] }))).toBe("https://i.example/a.png");
    expect(imageOf(post({ assets: [{ type: "document", mimeType: "application/pdf", source: "https://d.example/a.pdf" }] }))).toBeNull();
    expect(imageOf(post({ assets: [{ type: "image", mimeType: "image/png", source: "http://i.example/a.png" }] }))).toBeNull();
    expect(imageOf(post({}))).toBeNull();
  });
});

describe("runEchoes keeps going", () => {
  it("sends the remaining copies when saving one record fails", async () => {
    const sentTo: string[] = [];
    const plan = planEchoes([post({}), post({ id: "p2" })], [tg], [], now, long);
    const out = await runEchoes(plan, {
      claim: async () => true,
      send: async (s) => (sentTo.push(s.post.id), { messageId: "m" }),
      record: async (r) => { if (r.postId === "p1") throw new Error("database down"); },
      previous: () => undefined,
    });
    expect(sentTo).toEqual(["p1", "p2"]);
    expect(out.map((r) => r.status)).toEqual(["sent", "sent"]);
  });
});
