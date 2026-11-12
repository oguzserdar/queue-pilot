/**
 * The person's new material across their feeds, as the AI writer reads it: items not yet used for a post, with their
 * full text. A feed that fails to load is skipped, so one broken feed does not stop the others.
 */
import { freshItems, readFeed, scopeKeys, type FeedItem } from "./feeds";
import { postgresSourceStore } from "./sources-store";
import type { BriefMaterial } from "./ai-writer";
import { postgresMaterialStore } from "./material-store"

const PER_FEED = 3;

/**
 * Unused feed items and research text for this person's drafts.
 *
 * Items from the last 14 days come first. When there are none at all, each feed the person has never drafted from
 * gives its single newest item, marked as older, so a first run on a quiet blog still has something to write from.
 */
export async function newMaterial(userId: string): Promise<BriefMaterial[]> {
  const store = postgresSourceStore();
  const [sources, used, material] = await Promise.all([store.list(userId), store.usedKeys(userId), postgresMaterialStore().list(userId)])
  const feeds = await Promise.allSettled(sources.map((s) => readFeed(s.url)));
  const toMaterial = (title: string, it: FeedItem): BriefMaterial => ({ key: it.key, title: `${title}: ${it.title}`, url: it.url, text: it.body || it.summary, published: it.published, ...(it.truncated ? { truncated: true } : {}) });
  const research = material.filter((item) => !used.has(item.key)).map((item) => ({ key: item.key, title: item.title, url: item.link ?? null, text: item.text }));
  const fresh = sources.flatMap((src, i) => {
    const r = feeds[i];
    if (r.status === "rejected") return [];
    return freshItems(scopeKeys(src.id, r.value.items), used, src.url, PER_FEED).map((it) => toMaterial(src.title, it));
  });
  if (research.length || fresh.length) return [...research, ...fresh];
  return sources.flatMap((src, i) => {
    const r = feeds[i];
    // Only a feed never drafted from: once something of it was used, an older item must not be offered as news.
    if (r.status === "rejected" || [...used].some((k) => k.startsWith(`${src.id}:`))) return [];
    const newest = scopeKeys(src.id, r.value.items).find((it) => (it.body || it.summary).trim());
    return newest ? [toMaterial(`${src.title} (older, nothing new in 14 days)`, newest)] : [];
  });
}
