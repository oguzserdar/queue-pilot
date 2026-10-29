/**
 * YouTube transcripts through Supadata (api.supadata.ai). Optional: with
 * no key set, Queue Pilot gives the AI the video's title and description only. Any failure means "no transcript",
 * never a failed tool call.
 */
export const TRANSCRIPT_CHARS = 12_000;
const TIMEOUT_MS = 15_000;
const ENDPOINT = "https://api.supadata.ai/v1/youtube/transcript";

/** True for a YouTube watch, short or youtu.be link, the only links sent to Supadata. */
function isYouTubeVideo(url: string): boolean {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\.|^m\./, "");
    if (host === "youtu.be") return /^\/[\w-]{6,}$/.test(u.pathname);
    if (host !== "youtube.com") return false;
    return (u.pathname === "/watch" && /^[\w-]{6,}$/.test(u.searchParams.get("v") ?? "")) || /^\/shorts\/[\w-]{6,}$/.test(u.pathname);
  } catch {
    return false;
  }
}

/** The video's transcript as plain text, at most TRANSCRIPT_CHARS, or null when there is none to give. */
export async function youtubeTranscript(videoUrl: string, apiKey: string, fetchImpl: typeof fetch = fetch): Promise<string | null> {
  if (!apiKey || !isYouTubeVideo(videoUrl)) return null;
  try {
    const res = await fetchImpl(`${ENDPOINT}?url=${encodeURIComponent(videoUrl)}&text=true`, {
      headers: { "x-api-key": apiKey },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    // 202 means Supadata started a slow job; a transcript worth waiting for is not part of drafting.
    if (res.status !== 200) return null;
    const body = (await res.json()) as { content?: unknown };
    if (typeof body.content !== "string") return null;
    const text = body.content.replace(/\s+/g, " ").trim();
    if (!text) return null;
    return text.length > TRANSCRIPT_CHARS ? `${text.slice(0, TRANSCRIPT_CHARS - 1)}…` : text;
  } catch (e) {
    console.warn(JSON.stringify({ event: "qp-transcript-failed", message: e instanceof Error ? e.message : String(e) }));
    return null;
  }
}
