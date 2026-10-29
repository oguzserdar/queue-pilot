import { describe, expect, it, vi } from "vitest";
import { TRANSCRIPT_CHARS, youtubeTranscript } from "./transcripts";

const answer = (status: number, body: unknown) => vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));

describe("youtubeTranscript", () => {
  it("asks Supadata for the plain-text transcript of a YouTube video, with the key in the header", async () => {
    const f = answer(200, { content: "Today we make croutons from stale bread.", lang: "en" });
    expect(await youtubeTranscript("https://www.youtube.com/watch?v=abc123", "key-1", f)).toBe("Today we make croutons from stale bread.");
    const [url, init] = f.mock.calls[0];
    expect(String(url)).toBe("https://api.supadata.ai/v1/youtube/transcript?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3Dabc123&text=true");
    expect((init.headers as Record<string, string>)["x-api-key"]).toBe("key-1");
  });

  it("never sends a link that is not a YouTube video", async () => {
    const f = vi.fn();
    expect(await youtubeTranscript("https://example.com/watch?v=abc", "k", f)).toBeNull();
    expect(await youtubeTranscript("https://www.youtube.com/channel/UC1", "k", f)).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });

  it("returns nothing when there is no key, no captions, or Supadata fails", async () => {
    expect(await youtubeTranscript("https://youtu.be/abc123", "", vi.fn())).toBeNull();
    expect(await youtubeTranscript("https://youtu.be/abc123", "k", answer(404, { error: "transcript-unavailable" }))).toBeNull();
    expect(await youtubeTranscript("https://youtu.be/abc123", "k", answer(202, { jobId: "j1" }))).toBeNull();
    expect(await youtubeTranscript("https://youtu.be/abc123", "k", vi.fn().mockRejectedValue(new Error("down")))).toBeNull();
  });

  it("caps a long transcript", async () => {
    const t = await youtubeTranscript("https://youtu.be/abc123", "k", answer(200, { content: "word ".repeat(10_000) }));
    expect(t!.length).toBeLessThanOrEqual(TRANSCRIPT_CHARS);
  });
});
