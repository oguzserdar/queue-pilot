import { describe, expect, it } from "vitest";
import type { Post } from "./buffer/queries";
import { postsBetween } from "./posts-between";

const post = (id: string, dueAt: string | null) => ({ id, dueAt }) as Post;

describe("postsBetween", () => {
  it("keeps posts due inside the range, both ends included, and drops undated ones", () => {
    const posts = [post("before", "2026-10-25T23:59:59Z"), post("start", "2026-10-26T00:00:00Z"), post("mid", "2026-10-28T12:00:00Z"), post("end", "2026-11-01T23:59:59Z"), post("after", "2026-11-02T00:00:00Z"), post("undated", null)];
    const ids = postsBetween(posts, new Date("2026-10-26T00:00:00Z"), new Date("2026-11-01T23:59:59Z")).map((p) => p.id);
    expect(ids).toEqual(["start", "mid", "end"]);
  });
});
