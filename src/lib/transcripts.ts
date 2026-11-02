import { readCapped } from "./feeds";
/** Supadata native captions only. No generated transcription or block bypass. */
export const TRANSCRIPT_CHARS = 12_000;
const ENDPOINT = "https://api.supadata.ai/v1/transcript";
export type TranscriptResult =
  | { status: "ready"; text: string; segments: { text: string; seconds: number }[]; captions: "auto" | "manual" | "unknown"; truncated: boolean }
  | { status: "pending"; jobId: string }
  | { status: "unavailable" | "invalid-key" | "out-of-credits" | "rate-limited" | "failed" | "not-configured"; message: string };

export function isYouTubeVideo(url: string): boolean {
  try {
    const u = new URL(url);
    if (!["http:", "https:"].includes(u.protocol) || u.username || u.password) return false;
    const host = u.hostname.replace(/^www\.|^m\./, "");
    if (host === "youtu.be") return /^\/[\w-]{6,}$/.test(u.pathname);
    if (host !== "youtube.com") return false;
    return (u.pathname === "/watch" && /^[\w-]{6,}$/.test(u.searchParams.get("v") ?? "")) || /^\/shorts\/[\w-]{6,}$/.test(u.pathname);
  } catch { return false; }
}

/** Pure transport, also used to resume a persisted 202 job. No automatic polling loop. */
export async function fetchTranscript(url: string, key: string, jobId?: string, fetchImpl: typeof fetch = fetch): Promise<TranscriptResult> {
  if (!key) return { status: "not-configured", message: "The transcript key is not set." };
  if (!isYouTubeVideo(url)) return { status: "unavailable", message: "Use a YouTube video address." };
  if (jobId && !/^[\w-]{1,200}$/.test(jobId)) return { status: "failed", message: "The transcript job could not be read." };
  try {
    const endpoint = jobId ? `${ENDPOINT}/${encodeURIComponent(jobId)}` : `${ENDPOINT}?url=${encodeURIComponent(url)}&text=false&mode=native&lang=en`;
    const res = await fetchImpl(endpoint, { headers: { "x-api-key": key }, signal: AbortSignal.timeout(15_000) });
    if (res.status === 401 || res.status === 403) return { status: "invalid-key", message: "Supadata rejected the key." };
    if (res.status === 402) return { status: "out-of-credits", message: "Supadata credits are used up." };
    if (res.status === 429) return { status: "rate-limited", message: "Supadata asked us to wait. Try later." };
    if (res.status === 404) return { status: "unavailable", message: "No native transcript is available just now." };
    if (![200, 202, 206].includes(res.status)) return { status: "failed", message: "Supadata could not return the transcript." };
    const body = JSON.parse(await readCapped(res, 2_000_000));
    if (body.jobId && typeof body.jobId === "string" && /^[\w-]{1,200}$/.test(body.jobId)) return { status: "pending", jobId: body.jobId };
    if (jobId && ["queued", "active", "processing"].includes(body.status)) return { status: "pending", jobId };
    if (body.status === "failed" || body.error) {
      const code = typeof body.error === "string" ? body.error : body.error?.error;
      return code === "limit-exceeded" ? { status: "out-of-credits", message: "Supadata credits are used up." } : { status: "unavailable", message: "The native transcript job failed. The previous source was kept." };
    }
    const data = body.result ?? body;
    const segments = Array.isArray(data.content) ? data.content.filter((s: { text?: unknown; offset?: unknown }) => typeof s.text === "string" && typeof s.offset === "number" && Number.isFinite(s.offset) && s.offset >= 0).map((s: { text: string; offset: number }) => ({ text: s.text.replace(/\s+/g, " ").trim(), seconds: s.offset / 1000 })) : [];
    const full = (typeof data.content === "string" ? data.content : segments.map((s: { text: string }) => s.text).join(" ")).replace(/\s+/g, " ").trim();
    if (!full) return { status: "unavailable", message: "No native transcript is available just now." };
    const text = full.slice(0, TRANSCRIPT_CHARS);
    // The documented API does not guarantee provenance; never infer ASR from mode=native.
    return { status: "ready", text, segments: segments.filter((s: { text: string }) => text.includes(s.text)), captions: data.isGenerated === true ? "auto" : data.isGenerated === false ? "manual" : "unknown", truncated: full.length > TRANSCRIPT_CHARS || res.status === 206 };
  } catch { return { status: "failed", message: "The transcript could not be read. Try again later." }; }
}

/** Compatibility helper; persistent callers use transcriptForUser instead. */
export async function youtubeTranscript(url: string, key: string, fetchImpl: typeof fetch = fetch): Promise<string | null> {
  const r = await fetchTranscript(url, key, undefined, fetchImpl);
  return r.status === "ready" ? r.text : null;
}
