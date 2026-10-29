/**
 * The person's new material across their feeds, as the AI writer reads it: items not yet used for a post, with their
 * full text. A feed that fails to load is skipped, so one broken feed does not stop the others.
 */
import { newItems, readFeed, scopeKeys } from "./feeds";
import { postgresSourceStore } from "./sources-store";
import type { BriefMaterial } from "./ai-writer";

const PER_FEED = 3;

export async function newMaterial(userId: string): Promise<BriefMaterial[]> {
  const store = postgresSourceStore();
  const [sources, used] = await Promise.all([store.list(userId), store.usedKeys(userId)]);
  const feeds = await Promise.allSettled(sources.map((s) => readFeed(s.url)));
  return sources.flatMap((src, i) => {
    const r = feeds[i];
    if (r.status === "rejected") return [];
    return newItems(scopeKeys(src.id, r.value.items), used, PER_FEED).map((it) => ({ key: it.key, title: `${src.title}: ${it.title}`, url: it.url, text: it.body || it.summary }));
  });
}
