import "server-only";
/**
 * The person's open playbook offers: fixes they made to Queue Pilot's drafts in two or more posts, read from the saved
 * copy of their queue (no Buffer request), less fixes already kept as rules or set aside with "Not now".
 */
import { postgresSnapshotStore } from "./buffer/snapshot-store";
import { editsFrom, offerKey, openOffers } from "./fix-offers";
import { repeatedFixes, type Edit, type FixOffer } from "./fixes";
import { rewritesIn } from "./rewrite-rules";
import type { Rule } from "./rules";
import { postgresRulesStore } from "./rules-store";
import { postgresWrittenStore } from "./written-store";
import { checkKey, postgresVerdictStore } from "./fix-verdicts";
import { preferencesFrom } from "./confirm-fixes";

export async function currentOffers(userId: string): Promise<(FixOffer & { key: string })[]> {
  const snap = await postgresSnapshotStore().get(userId);
  const posts = (snap?.data.posts ?? []).filter((p) => !p.id.startsWith("pending:"));
  if (!posts.length) return [];
  const store = postgresRulesStore();
  const [written, rules, dismissed] = await Promise.all([
    postgresWrittenStore().get(userId, posts.map((p) => p.id)),
    store.list(userId),
    store.dismissed(userId),
  ]);
  const offers = openOffers(repeatedFixes(editsFrom(written, posts.map((p) => ({ id: p.id, channelId: p.channelId, text: p.text ?? "" })))), rules, dismissed);
  return offers.map((o) => ({ ...o, key: offerKey(o) }));
}

/**
 * The repeated fixes worth telling the person about, for Home and the Playbook, without an AI call. When the model has
 * already judged this exact set of repeats, only the ones it called lasting preferences are left; until then every
 * open repeat counts, and the Playbook asks the model when it opens.
 */
export async function waitingRepeats(userId: string): Promise<(FixOffer & { key: string })[]> {
  const offers = await currentOffers(userId);
  if (!offers.length) return [];
  const saved = await postgresVerdictStore().get(userId, checkKey(offers)).catch(() => null);
  return saved?.kind === "answer" ? preferencesFrom(offers, saved.verdicts) : offers;
}

/** The person's rewrites of Queue Pilot's drafts (edits too big for one fix) and their rules, for rewrite-rules.ts. */
export async function currentRewrites(userId: string): Promise<{ rewrites: Edit[]; rules: Rule[] }> {
  const snap = await postgresSnapshotStore().get(userId);
  const posts = (snap?.data.posts ?? []).filter((p) => !p.id.startsWith("pending:"));
  if (!posts.length) return { rewrites: [], rules: [] };
  const [written, rules] = await Promise.all([postgresWrittenStore().get(userId, posts.map((p) => p.id)), postgresRulesStore().list(userId)]);
  return { rewrites: rewritesIn(editsFrom(written, posts.map((p) => ({ id: p.id, channelId: p.channelId, text: p.text ?? "" })))), rules };
}
