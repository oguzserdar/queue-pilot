import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ headers: async () => new Headers({ host: "getqueuepilot.com", "x-forwarded-proto": "https" }) }));
vi.mock("next/font/google", () => ({ Schibsted_Grotesk: () => ({ variable: "" }) }));
vi.mock("@vercel/analytics/next", () => ({ Analytics: () => null }));

describe("link preview", () => {
  it("points og:video at a file that ships, as an MP4 the size of the card", async () => {
    const { generateMetadata } = await import("./layout");
    const meta = await generateMetadata();
    const videos = [meta.openGraph?.videos].flat().filter(Boolean) as { url: string; type: string; width: number; height: number }[];
    expect(videos).toHaveLength(1);
    const [video] = videos;
    expect(video.type).toBe("video/mp4");
    expect([video.width, video.height]).toEqual([2400, 1260]);
    expect(existsSync(join(process.cwd(), "public", video.url))).toBe(true);
  });
});
