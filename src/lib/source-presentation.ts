import { evidenceForPosts, evidenceNeedsCheck, sourceById, latestSource } from "./source-store";
import type { Post, Channel } from "./buffer/queries";
import { unsent } from "./source-check";

export type EvidenceCard = {
  sourceKey?: string; channel?: string; network?: string; dueAt?: string | null; timeZone?: string;
  postId: string; snapshotId: string; title: string; uri: string; claim: string; quote: string | null; locator: string | null;
  captions?: "auto" | "manual" | "unknown"; paidPreview?: boolean; truncated?: boolean; lastCheckedAt: string;
  needsCheck: boolean; changed: boolean; scheduled: boolean; editable: boolean; oldText: string; newText: string;
  draftText: string; why: string; rewrite?: string;
};
export async function sourceCards(userId: string, posts: Post[], channels: Channel[] = []): Promise<EvidenceCard[]> {
  const waiting = posts.filter(unsent);
  const evidence = await evidenceForPosts(userId, waiting.map(p => p.id));
  const originals = await Promise.all([...new Set(evidence.map(e => e.snapshotId))].map(id => sourceById(userId, id)));
  const latest = await Promise.all([...new Set(originals.flatMap(s => s ? [s.sourceKey] : []))].map(key => latestSource(userId, key)));
  return evidence.flatMap(e => {
    const old = originals.find(s => s?.id === e.snapshotId);
    const current = latest.find(s => s?.sourceKey === old?.sourceKey);
    const post = waiting.find(p => p.id === e.bufferPostId);
    if (!old || !current || !post) return [];
    const judgment = e.judgment?.snapshotId === current.id && e.judgment.draftText === post.text ? e.judgment : null;
    const needsCheck = evidenceNeedsCheck(e, current, post.text);
    const channel = channels.find(c => c.id === post.channelId);
    return [{ sourceKey: current.sourceKey, channel: channel?.name ?? post.channelId, network: channel?.service, dueAt: post.dueAt, timeZone: channel?.timezone, postId: post.id, snapshotId: e.snapshotId, title: current.title ?? "Source", uri: current.uri, claim: e.claim, quote: e.quote, locator: e.locator,
      captions: old.metadata.captions, paidPreview: old.metadata.paidPreview, truncated: old.metadata.truncated, lastCheckedAt: current.lastCheckedAt.toISOString(), needsCheck, changed: current.id !== old.id,
      scheduled: post.status === "scheduled", editable: post.status === "draft", oldText: old.text, newText: current.text, draftText: post.text,
      why: judgment?.why ?? (needsCheck ? "Check this draft against the current source." : "The quote matches the saved source version."),
      ...(judgment && !judgment.holds && judgment.rewrite ? { rewrite: judgment.rewrite } : {}),
    }];
  });
}

/** The pages already loaded these cards. Do not query the same evidence again for their approval state. */
export function sourceHoldsFromCards(cards: EvidenceCard[]) {
 return new Map(cards.filter(c => c.needsCheck).map(c => [c.postId, c.why]));
}
