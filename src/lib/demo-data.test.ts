import { describe, expect, it } from "vitest";
import { channels, posts } from "./demo-data";
import { channelCheck } from "./preflight";

describe("example drafts", () => {
  it("show only checks Queue Pilot runs: channel status and length, made by the real check functions", () => {
    const allowed = new Set(channels.map((c) => channelCheck({ ...c, isLocked: false }).detail));
    for (const p of posts.filter((x) => x.status === "draft"))
      for (const c of p.checks ?? []) expect(allowed.has(c.label) || /^Fits .+ \(\d[\d,]* of [\d,]+ characters\)$/.test(c.label) || /^\d+ characters; .+ allows \d+$/.test(c.label)).toBe(true);
  });

  it("flag the disconnected Bluesky channel the way a real draft is flagged", () => {
    const bluesky = posts.find((p) => p.channel === "bluesky" && p.status === "draft")!;
    expect(bluesky.checks?.[0]).toMatchObject({ tone: "danger", label: expect.stringContaining("disconnected in Buffer") });
  });
});
