import { describe, expect, it, vi } from "vitest";
import { youtubeTranscript } from "./transcripts";

const answer = (status: number, body: unknown) => vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));

describe("youtubeTranscript", () => {
  it("asks Supadata for the plain-text transcript of a YouTube video, with the key in the header", async () => {
    const f = answer(200, { content: "Today we make croutons from stale bread.", lang: "en" });
    expect(await youtubeTranscript("https://www.youtube.com/watch?v=abc123", "key-1", f)).toBe("Today we make croutons from stale bread.");
    const [url, init] = f.mock.calls[0];
    expect(String(url)).toBe("https://api.supadata.ai/v1/transcript?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3Dabc123&text=false&mode=native&lang=en");
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

  it("retains the entire transcript, including the final sentence", async () => {
    const full = "word ".repeat(30_000) + "The final sentence matters.";
    const t = await youtubeTranscript("https://youtu.be/abc123", "k", answer(200, { content: full }));
    expect(t).toBe(full);
  });
});

describe("native transcript jobs", () => {
  it("keeps a pending job and polls its endpoint instead of starting over", async () => {
    const { fetchTranscript } = await import("./transcripts");
    expect(await fetchTranscript("https://youtu.be/abc123", "key", undefined, answer(202, { jobId: "job-1" }))).toEqual({ status: "pending", jobId: "job-1" });
    const poll = answer(200, { status: "completed", result: { content: [{ text: "A quote.", offset: 12500, duration: 1000 }] } });
    expect(await fetchTranscript("https://youtu.be/abc123", "key", "job-1", poll)).toMatchObject({ status: "ready", segments: [{ text: "A quote.", seconds: 12.5 }], captions: "unknown" });
    expect(poll.mock.calls[0][0]).toBe("https://api.supadata.ai/v1/transcript/job-1");
  });
  it.each([[401, "invalid-key"], [402, "out-of-credits"], [429, "rate-limited"]])("reports %s without retrying or generating", async (status, expected) => {
    const { fetchTranscript } = await import("./transcripts"); const f = answer(Number(status), {});
    expect(await fetchTranscript("https://youtu.be/abc123", "key", undefined, f)).toMatchObject({ status: expected }); expect(f).toHaveBeenCalledOnce();
  });
  it("marks a partial response and does not infer caption provenance", async () => {
    const { fetchTranscript } = await import("./transcripts");
    expect(await fetchTranscript("https://youtu.be/abc123", "key", undefined, answer(206, { content: "Partial" }))).toMatchObject({ status: "ready", truncated: true, captions: "unknown" });
  });
});

it("does not drop invalid caption rows and then call the result complete", async () => {
 const { fetchTranscript } = await import("./transcripts");
 expect(await fetchTranscript("https://youtu.be/abc123", "k", undefined, answer(200, { content: [{ text: "Opening", offset: 0 }, { text: "Closing", offset: null }] }))).toMatchObject({ status: "failed" });
});
it("retains a provider response beyond the former two-megabyte response ceiling", async () => {
 const { fetchTranscript } = await import("./transcripts"); const full = "Background sentence. ".repeat(110_000) + "End of the episode.";
 const result = await fetchTranscript("https://youtu.be/abc123", "k", undefined, answer(200, { content: full }));
 expect(result).toMatchObject({ status: "ready", text: full, truncated: false });
});
