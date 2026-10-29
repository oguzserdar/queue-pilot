import { describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({ db: () => { throw new Error("no database in this test"); } }));
const { exampleFromQueue } = await import("./voice-store");

const data = {
  channels: [{ id: "x", name: "X" }],
  posts: [
    { id: "s1", channelId: "x", status: "sent", text: "Shipped CSV export." },
    { id: "d1", channelId: "x", status: "draft", text: "Not out yet." },
    { id: "s2", channelId: "gone", status: "sent", text: "From a removed channel." },
    { id: "s3", channelId: "x", status: "sent", text: "   " },
  ],
};

describe("exampleFromQueue", () => {
  it("takes a sent post's own text and channel name", () => {
    expect(exampleFromQueue(data, "s1")).toEqual({ postId: "s1", channel: "X", text: "Shipped CSV export." });
  });
  it("refuses drafts, empty posts and ids that are not in the user's queue", () => {
    expect(exampleFromQueue(data, "d1")).toBeNull();
    expect(exampleFromQueue(data, "s3")).toBeNull();
    expect(exampleFromQueue(data, "someone-elses-post")).toBeNull();
  });
  it("names a channel that is gone 'Buffer'", () => {
    expect(exampleFromQueue(data, "s2")?.channel).toBe("Buffer");
  });
});
