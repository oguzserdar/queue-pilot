import { describe, expect, it } from "vitest";
import { channels, demoPosts } from "./demo-data";

const posts = demoPosts(0);
import { channelCheck } from "./preflight";

describe("example drafts", () => {
  it("show only checks Queue Pilot runs: channel status and length, made by the real check functions", () => {
    const allowed = new Set(channels.map((c) => channelCheck({ ...c, isLocked: false }).detail));
    for (const p of posts.filter((x) => x.status === "draft"))
      for (const c of p.checks ?? []) expect(allowed.has(c.label) || /^Fits .+ \(\d[\d,]* of [\d,]+ characters\)$/.test(c.label) || /^\d+ characters; .+ allows \d+$/.test(c.label)).toBe(true);
  });

  it("flag the disconnected Threads channel the way a real draft is flagged", () => {
    const threads = posts.find((p) => p.channel === "threads" && p.status === "draft")!;
    expect(threads.checks?.[0]).toMatchObject({ tone: "danger", label: expect.stringContaining("disconnected in Buffer") });
  });
});
