import { createHash } from "node:crypto";
import { supadataKey } from "./env";
import { fetchTranscript, isYouTubeVideo, type TranscriptResult } from "./transcripts";
import { claimSourceJob, pendingTranscriptJob, releaseSourceJob, saveTranscriptJob } from "./source-store";

export async function transcriptForUser(userId: string, url: string): Promise<TranscriptResult> {
  if (!isYouTubeVideo(url)) return { status: "unavailable", message: "Use a YouTube video address." };
  const apiKey = await supadataKey();
  if (!apiKey) return { status: "not-configured", message: "The transcript key is not set." };
  const parsed = new URL(url);
  const videoId = parsed.searchParams.get("v") ?? parsed.pathname.split("/").pop();
  url = `https://www.youtube.com/watch?v=${videoId}`;
  const key = `transcript:${createHash("sha256").update(`${url}:${apiKey}`).digest("hex")}`;
  const pending = await pendingTranscriptJob(userId, key);
  if (pending?.value.jobId) {
    const result = await fetchTranscript(url, apiKey, pending.value.jobId);
    if (result.status === "ready" || result.status === "unavailable") await releaseSourceJob(userId, key, pending.token);
    return result;
  }
  const token = await claimSourceJob(userId, key);
  if (!token) return { status: "failed", message: "This transcript is being requested. Try again in a minute." };
  const result = await fetchTranscript(url, apiKey);
  if (result.status === "pending") await saveTranscriptJob(userId, key, token, result.jobId);
  else await releaseSourceJob(userId, key, token);
  return result;
}
