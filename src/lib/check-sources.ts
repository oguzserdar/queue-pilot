import { feedUrl, itemsFromXml, readCapped, splitKey } from "./feeds";
import { safeFetch } from "./safe-fetch";
import { postgresSourceStore } from "./sources-store";
import { listSourcesToCheck, reportSourceVersion } from "./source-check";
import { latestSource } from "./source-store";
import { isYouTubeVideo } from "./transcripts";
import { transcriptForUser } from "./transcript-for-user";
import type { Post } from "./buffer/queries";

/** One feed read per run, not per draft. A missing item, 404 or partial transcript never replaces evidence. */
export async function checkSources(userId: string, readPosts: () => Promise<Post[]>) {
  const tracked = await listSourcesToCheck(userId, await readPosts());
  const feeds = await postgresSourceStore().list(userId);
  const cache = new Map<string, Awaited<ReturnType<typeof itemsFromXml>>>();
  const results: { sourceKey: string; message: string }[] = [];
  for (const source of [...tracked].sort((a, b) => a.lastCheckedAt.localeCompare(b.lastCheckedAt)).slice(0, 10)) {
    try {
      const old = await latestSource(userId, source.sourceKey);
      if (!old) continue;
      let text: string | undefined;
      let metadata = old.metadata;
      if (isYouTubeVideo(source.uri) && old.metadata.kind !== "video-description") {
        const r = await transcriptForUser(userId, source.uri);
        if (r.status !== "ready") { results.push({ sourceKey: source.sourceKey, message: r.status === "pending" ? "Transcript processing. Check again later." : r.message }); continue; }
        if (r.truncated && !old.metadata.truncated) { results.push({ sourceKey: source.sourceKey, message: "Only a transcript excerpt returned. The previous full source was kept." }); continue; }
        text = r.text; metadata = { kind: "transcript", excerptWindow: "prefix-12000", segments: r.segments, captions: r.captions, truncated: r.truncated };
      } else {
        const parts = splitKey(source.sourceKey);
        const feed = feeds.find(f => f.id === parts?.sourceId);
        if (!feed) { results.push({ sourceKey: source.sourceKey, message: "Ask your AI to read this source and report its current text." }); continue; }
        let parsed = cache.get(feed.id);
        if (!parsed) {
          const response = await safeFetch(new URL(feedUrl(feed.url)), { signal: AbortSignal.timeout(10_000), headers: { accept: "application/atom+xml, application/rss+xml", ...(old.metadata.etag ? { "If-None-Match": old.metadata.etag } : {}), ...(old.metadata.lastModified ? { "If-Modified-Since": old.metadata.lastModified } : {}) } });
          if (response.status === 304) { text = old.text; }
          else {
            if (!response.ok) throw new Error("The feed is unavailable; the previous source was kept.");
            parsed = itemsFromXml(await readCapped(response, 2_000_000)); cache.set(feed.id, parsed);
            metadata = { ...metadata, etag: response.headers.get("etag") ?? undefined, lastModified: response.headers.get("last-modified") ?? undefined };
          }
        }
        if (parsed) {
          const item = parsed.items.find(i => i.key === parts?.itemKey);
          if (item?.truncated && !old.metadata.truncated) { results.push({ sourceKey: source.sourceKey, message: "The feed returned only an excerpt. The previous source was kept; ask your AI to check the full text." }); continue; }
          text = item?.body;
          if (item) metadata = { ...metadata, truncated: !!item.truncated };
        }
      }
      if (!text?.trim()) { results.push({ sourceKey: source.sourceKey, message: "No matching source text returned; the previous version was kept." }); continue; }
      const r = await reportSourceVersion(userId, { sourceKey: source.sourceKey, uri: source.uri, text, title: source.title ?? undefined, checkedBy: "user" }, readPosts, metadata);
      results.push({ sourceKey: source.sourceKey, message: `${r.changed ? "New source version saved" : "Source unchanged"}. ${r.proposals} proposed corrections. ${r.pending} checks pending.${r.scheduled.length ? " Already scheduled posts remain scheduled in Buffer." : ""}` });
    } catch { results.push({ sourceKey: source.sourceKey, message: "This source could not be checked. Its drafts still need review; no Buffer post was changed." }); }
  }
  if (tracked.length > 10) results.push({ sourceKey: "", message: `${tracked.length - 10} sources were not checked in this run. Ask your connected AI to check the remaining sources individually.` });
  return results;
}
