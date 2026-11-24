/** Supadata native captions only. No generated transcription or block bypass. */
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
    const refused = httpProblem(res.status);
    if (refused) return refused;
    const body = await res.json();
    if (body.jobId && typeof body.jobId === "string" && /^[\w-]{1,200}$/.test(body.jobId)) return { status: "pending", jobId: body.jobId };
    if (jobId && ["queued", "active", "processing"].includes(body.status)) return { status: "pending", jobId };
    if (body.status === "failed" || body.error) return jobFailure(body.error);
    const data = body.result ?? body;
    const segments = captionSegments(data.content);
    if (!segments) return { status: "failed", message: "The transcript contained invalid captions or timestamps. No partial transcript was kept." };
    const full = (typeof data.content === "string" ? data.content : segments.map((s) => s.text).join(" ")).replace(/\s+/g, " ").trim();
    if (!full) return { status: "unavailable", message: "No native transcript is available just now." };
    const text = full;
    // The documented API does not guarantee provenance; never infer ASR from mode=native.
    return { status: "ready", text, segments, captions: captionsKind(data.isGenerated), truncated: res.status === 206 };
  } catch { return { status: "failed", message: "The transcript could not be read. Try again later." }; }
}

/** The answer for an HTTP status that carries no transcript, or null for 200, 202 and 206. */
function httpProblem(status: number): TranscriptResult | null {
  if (status === 401 || status === 403) return { status: "invalid-key", message: "Supadata rejected the key." };
  if (status === 402) return { status: "out-of-credits", message: "Supadata credits are used up." };
  if (status === 429) return { status: "rate-limited", message: "Supadata asked us to wait. Try later." };
  if (status === 404) return { status: "unavailable", message: "No native transcript is available just now." };
  if (![200, 202, 206].includes(status)) return { status: "failed", message: "Supadata could not return the transcript." };
  return null;
}

/** A failed job: out of credits when Supadata says the limit was exceeded, else unavailable. */
function jobFailure(error: unknown): TranscriptResult {
  const code = typeof error === "string" ? error : fieldOf(error, "error");
  return code === "limit-exceeded" ? { status: "out-of-credits", message: "Supadata credits are used up." } : { status: "unavailable", message: "The native transcript job failed. The previous source was kept." };
}

/** One field of an answer value, or undefined when it is not an object. */
function fieldOf(x: unknown, key: string): unknown {
  return typeof x === "object" && x !== null ? Reflect.get(x, key) : undefined;
}

/** True for a caption with text and a finite, non-negative offset in milliseconds. */
function isCaption(s: unknown): s is { text: string; offset: number } {
  const offset = fieldOf(s, "offset");
  return typeof fieldOf(s, "text") === "string" && typeof offset === "number" && Number.isFinite(offset) && offset >= 0;
}

/**
 * The captions with their start in seconds; none when the content is not a list (a plain-text transcript), and null
 * when any caption lacks text or a valid timestamp, so no partial transcript is kept.
 */
function captionSegments(content: unknown): { text: string; seconds: number }[] | null {
  if (!Array.isArray(content)) return [];
  const captions: unknown[] = content;
  if (!captions.every(isCaption)) return null;
  return captions.filter(isCaption).map((s) => ({ text: s.text.replace(/\s+/g, " ").trim(), seconds: s.offset / 1000 }));
}

/** Whether Supadata says the captions were generated; only an explicit true or false counts. */
function captionsKind(isGenerated: unknown): "auto" | "manual" | "unknown" {
  if (isGenerated === true) return "auto";
  return isGenerated === false ? "manual" : "unknown";
}

/** Compatibility helper; persistent callers use transcriptForUser instead. */
export async function youtubeTranscript(url: string, key: string, fetchImpl: typeof fetch = fetch): Promise<string | null> {
  const r = await fetchTranscript(url, key, undefined, fetchImpl);
  return r.status === "ready" ? r.text : null;
}
