import { captureSource, latestSource } from "./source-store";
import { postgresMaterialStore } from "./material-store";
import { postgresSourceStore } from "./sources-store";
import { readFeed, splitKey } from "./feeds";
import { isYouTubeVideo } from "./transcripts";

/** Compatibility for older save_drafts clients. Resolve only this account's material. */
export async function resolveSource(userId: string, sourceKey: string) {
  const existing = await latestSource(userId, sourceKey);
  if (existing) return existing;
  if (sourceKey.startsWith("material:")) {
    const item = await postgresMaterialStore().get(userId, sourceKey);
    return item ? captureSource(userId, { sourceKey, uri: item.link ?? `urn:qp:${sourceKey}`, title: item.title.slice(0, 200), text: item.text }) : null;
  }
  const parts = splitKey(sourceKey);
  if (!parts) return null;
  const feed = (await postgresSourceStore().list(userId)).find(s => s.id === parts.sourceId);
  if (!feed) return null;
  const item = (await readFeed(feed.url)).items.find(i => i.key === parts.itemKey);
  if (!item) return null;
  return captureSource(userId, { sourceKey, uri: item.url ?? feed.url, title: item.title.slice(0, 200), text: item.body || item.summary }, { truncated: item.truncated, ...(item.url && isYouTubeVideo(item.url) ? { kind: "video-description" as const } : {}) });
}
