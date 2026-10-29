import { describe, expect, it } from "vitest";
import { MAX_SOURCES, TooManySourcesError, memorySourceStore } from "./sources-store";

describe("source store rules", () => {
  it("adds a feed once, even when the same URL is added twice", async () => {
    const s = memorySourceStore();
    const a = await s.add("u1", "https://x.example/feed", "Blog");
    const b = await s.add("u1", "https://x.example/feed", "Blog again");
    expect(b.id).toBe(a.id);
    expect(await s.list("u1")).toHaveLength(1);
  });

  it("keeps each user's feeds and used items apart", async () => {
    const s = memorySourceStore();
    await s.add("u1", "https://x.example/feed", "Blog");
    await s.markUsed("u1", ["post-1"]);
    expect(await s.list("u2")).toEqual([]);
    expect((await s.usedKeys("u2")).size).toBe(0);
    expect([...(await s.usedKeys("u1"))]).toEqual(["post-1"]);
  });

  it(`refuses an eleventh feed with a sentence the user can act on (max ${MAX_SOURCES})`, async () => {
    const s = memorySourceStore();
    for (let i = 0; i < MAX_SOURCES; i++) await s.add("u1", `https://x.example/${i}`, `Feed ${i}`);
    await expect(s.add("u1", "https://x.example/extra", "One more")).rejects.toBeInstanceOf(TooManySourcesError);
  });

  it("removes only the given feed", async () => {
    const s = memorySourceStore();
    const a = await s.add("u1", "https://x.example/a", "A");
    await s.add("u1", "https://x.example/b", "B");
    await s.remove("u1", a.id);
    expect((await s.list("u1")).map((x) => x.title)).toEqual(["B"]);
  });

  it("marks used items once", async () => {
    const s = memorySourceStore();
    await s.markUsed("u1", ["k", "k"]);
    await s.markUsed("u1", ["k"]);
    expect([...(await s.usedKeys("u1"))]).toEqual(["k"]);
  });
});
