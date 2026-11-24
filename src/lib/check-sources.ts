import { feedUrl, itemsFromXml, readCapped, splitKey } from "./feeds";
import { safeFetch } from "./safe-fetch";
import { postgresSourceStore } from "./sources-store";
import { listSourcesToCheck, reportSourceVersion } from "./source-check";
import { latestSource } from "./source-store";
import { isYouTubeVideo } from "./transcripts";
import { transcriptForUser } from "./transcript-for-user";
import type { Post } from "./buffer/queries";

type Tracked = Awaited<ReturnType<typeof listSourcesToCheck>>[number];
type Saved = NonNullable<Awaited<ReturnType<typeof latestSource>>>;
type Metadata = Saved["metadata"];
type Feed = Awaited<ReturnType<ReturnType<typeof postgresSourceStore>["list"]>>[number];
type FeedCache = Map<string, ReturnType<typeof itemsFromXml>>;
/** What one source read gave: its current text (none when nothing matched) and metadata, or why it was not read. */
type Read = { text?: string; metadata: Metadata } | { message: string };

/** One feed read per run, not per draft. A missing item, 404 or partial transcript never replaces evidence. */
export async function checkSources(userId: string, readPosts: () => Promise<Post[]>) {
  const tracked = await listSourcesToCheck(userId, await readPosts());
  const feeds = await postgresSourceStore().list(userId);
  const cache: FeedCache = new Map();
  const results: { sourceKey: string; message: string }[] = [];
  for (const source of [...tracked].sort((a, b) => a.lastCheckedAt.localeCompare(b.lastCheckedAt)).slice(0, 10)) {
    try {
      const message = await checkOne(userId, source, feeds, cache, readPosts);
      if (message !== null) results.push({ sourceKey: source.sourceKey, message });
    } catch { results.push({ sourceKey: source.sourceKey, message: "This source could not be checked. Its drafts still need review; no Buffer post was changed." }); }
  }
  if (tracked.length > 10) results.push({ sourceKey: "", message: `${tracked.length - 10} sources were not checked in this run. Ask your connected AI to check the remaining sources individually.` });
  return results;
}

/** Checks one tracked source and saves a new version when its text changed; null when there is no earlier version. */
async function checkOne(userId: string, source: Tracked, feeds: Feed[], cache: FeedCache, readPosts: () => Promise<Post[]>): Promise<string | null> {
  const old = await latestSource(userId, source.sourceKey);
  if (!old) return null;
  const read = isYouTubeVideo(source.uri) && old.metadata.kind !== "video-description"
    ? await readVideo(userId, source.uri)
    : await readFeedItem(source.sourceKey, old, feeds, cache);
  if ("message" in read) return read.message;
  const { text, metadata } = read;
  if (!text?.trim()) return "No matching source text returned; the previous version was kept.";
  const r = await reportSourceVersion(userId, { sourceKey: source.sourceKey, uri: source.uri, text, title: source.title ?? undefined, checkedBy: "user" }, readPosts, metadata);
  return `${r.changed ? "New source version saved" : "Source unchanged"}. ${r.proposals} proposed corrections. ${r.pending} checks pending.${r.scheduled.length ? " Already scheduled posts remain scheduled in Buffer." : ""}`;
}

/** A video's complete transcript; a pending or partial one keeps the previous source. */
async function readVideo(userId: string, uri: string): Promise<Read> {
  const r = await transcriptForUser(userId, uri);
  if (r.status !== "ready") return { message: r.status === "pending" ? "Transcript processing. Check again later." : r.message };
  if (r.truncated) return { message: "Only a transcript excerpt returned. The previous source was kept; retry for the complete transcript." };
  return { text: r.text, metadata: { kind: "transcript", segments: r.segments, captions: r.captions, truncated: r.truncated } };
}

/** The source's item in its feed, reading each feed once per run (a 304 keeps the saved text). */
async function readFeedItem(sourceKey: string, old: Saved, feeds: Feed[], cache: FeedCache): Promise<Read> {
  const parts = splitKey(sourceKey);
  const feed = feeds.find(f => f.id === parts?.sourceId);
  if (!feed) return { message: "Ask your AI to read this source and report its current text." };
  let metadata = old.metadata;
  let parsed = cache.get(feed.id);
  if (!parsed) {
    const response = await safeFetch(new URL(feedUrl(feed.url)), { signal: AbortSignal.timeout(10_000), headers: { accept: "application/atom+xml, application/rss+xml", ...(old.metadata.etag ? { "If-None-Match": old.metadata.etag } : {}), ...(old.metadata.lastModified ? { "If-Modified-Since": old.metadata.lastModified } : {}) } });
    if (response.status === 304) return { text: old.text, metadata };
    if (!response.ok) throw new Error("The feed is unavailable; the previous source was kept.");
    parsed = itemsFromXml(await readCapped(response, 2_000_000)); cache.set(feed.id, parsed);
    metadata = { ...metadata, etag: response.headers.get("etag") ?? undefined, lastModified: response.headers.get("last-modified") ?? undefined };
  }
  const item = parsed.items.find(i => i.key === parts?.itemKey);
  if (item?.truncated && !old.metadata.truncated) return { message: "The feed returned only an excerpt. The previous source was kept; ask your AI to check the full text." };
  if (item) metadata = { ...metadata, truncated: !!item.truncated };
  return { text: item?.body, metadata };
}
