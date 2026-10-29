import { describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({ db: () => { throw new Error("no database in this test"); } }));
const { exampleFromQueue } = await import("./voice-store");
const { addPastedExample, memoryVoiceStore, MAX_EXAMPLES, MAX_PASTED_TEXT } = await import("./voice-store")

describe("pasted writing examples", () => {
  it("keeps the full allowed text with unique ids and a readable channel", async () => {
    const store = memoryVoiceStore()
    await addPastedExample(store, "a", "x".repeat(MAX_PASTED_TEXT))
    await addPastedExample(store, "a", "Another post")
    const { examples } = await store.get("a")
    expect(examples[0].text).toHaveLength(MAX_PASTED_TEXT)
    expect(examples[0].channel).toBe("Pasted")
    expect(examples[0].postId).toMatch(/^pasted:/)
    expect(examples[1].postId).not.toBe(examples[0].postId)
    await store.removeExample("b", examples[0].postId)
    expect((await store.get("a")).examples).toHaveLength(2)
  })

  it("rejects invisible or oversized text and shares the eight-post cap", async () => {
    const store = memoryVoiceStore()
    await expect(addPastedExample(store, "a", "\u200b")).rejects.toThrow("Paste a post")
    await expect(addPastedExample(store, "a", "x".repeat(MAX_PASTED_TEXT + 1))).rejects.toThrow("2000")
    for (let i = 0; i < MAX_EXAMPLES; i++) await addPastedExample(store, "a", `${i}`)
    await expect(addPastedExample(store, "a", "more")).rejects.toThrow("Remove one")
    expect((await store.get("b")).examples).toEqual([])
  })
})

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
