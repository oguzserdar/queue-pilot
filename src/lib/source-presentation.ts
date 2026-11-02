import { evidenceForPosts, evidenceNeedsCheck, sourceById, latestSource } from "./source-store";
import type { Post } from "./buffer/queries";
import { unsent } from "./source-check";

export type EvidenceCard = {
  postId: string; snapshotId: string; title: string; uri: string; claim: string; quote: string | null; locator: string | null;
  captions?: "auto" | "manual" | "unknown"; paidPreview?: boolean; truncated?: boolean; lastCheckedAt: string;
  needsCheck: boolean; changed: boolean; scheduled: boolean; editable: boolean; oldText: string; newText: string;
  draftText: string; why: string; rewrite?: string;
};
export async function sourceCards(userId: string, posts: Post[]): Promise<EvidenceCard[]> {
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
    return [{ postId: post.id, snapshotId: e.snapshotId, title: current.title ?? "Source", uri: current.uri, claim: e.claim, quote: e.quote, locator: e.locator,
      captions: old.metadata.captions, paidPreview: old.metadata.paidPreview, truncated: old.metadata.truncated, lastCheckedAt: current.lastCheckedAt.toISOString(), needsCheck, changed: current.id !== old.id,
      scheduled: post.status === "scheduled", editable: post.status === "draft", oldText: old.text, newText: current.text, draftText: post.text,
      why: judgment?.why ?? (needsCheck ? "Check this draft against the current source." : "The quote matches the saved source version."),
      ...(judgment && !judgment.holds && judgment.rewrite ? { rewrite: judgment.rewrite } : {}),
    }];
  });
}
