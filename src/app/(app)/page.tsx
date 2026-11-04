import { sourceCards, sourceHoldsFromCards } from "@/lib/source-presentation";
import { SourceEvidencePanel } from "@/components/source-evidence";
import { redirect } from "next/navigation";
import { NeedsYouView } from "@/components/needs-you-view";
import { setupReadiness } from "@/lib/setup-readiness";
import { approvedAiApps, getCurrentUser, signedInUserId } from "@/lib/current-user";
import { postgresSourceStore } from "@/lib/sources-store";
import { postgresVoiceStore } from "@/lib/voice-store";
import { needsFromBuffer } from "@/lib/needs-model";
import { triageFromBuffer } from "@/lib/triage-model";
import { draftReadiness, type Readiness } from "@/lib/draft-readiness";
import { postgresWrittenStore } from "@/lib/written-store";
import { postgresRulesStore } from "@/lib/rules-store";
import { postgresReviewStore } from "@/lib/review-store";

export default async function Page() {
  const { user } = await getCurrentUser();
  // The proxy saw a session cookie, but the session is gone (expired or signed out elsewhere): show the landing page.
  if (!user) redirect("/welcome");
  // Signed in: only facts the Buffer snapshot and the user's saved feeds back.
  const userId = await signedInUserId();
  const [sources, aiApps, voice] = await Promise.all([userId ? postgresSourceStore().list(userId) : [], approvedAiApps(), userId ? postgresVoiceStore().get(userId) : null]);
  const readiness = setupReadiness(user, sources, aiApps, voice);
  const needs = needsFromBuffer(user.channels, user.posts, new Date(), user.timeZone);
  const now = new Date();
  // Each draft Queue Pilot wrote, with how it did against the current playbook.
  const draftIds = user.posts.filter((p) => p.status === "draft").map((p) => p.id);
  const [written, rules, links] = await Promise.all([
    userId ? postgresWrittenStore().get(userId, draftIds).catch(() => []) : [],
    userId ? postgresRulesStore().list(userId).catch(() => null) : null,
    userId ? postgresReviewStore().list(userId).catch(() => []) : [],
  ]);
  // The same test Approve uses, so this page never offers an approval the button would refuse.
  const postsById = new Map(user.posts.map(p => [p.id, p]));
  const channelsById = new Map(user.channels.map(c => [c.id, c]));
  const checks: Record<string, Readiness> = Object.fromEntries(written.map(w => {
    const post = postsById.get(w.postId);
    const network = post ? channelsById.get(post.channelId)?.service ?? w.network : w.network;
    return [w.postId, rules
      ? draftReadiness(w, post?.text ?? "", rules, { network, channelId: post?.channelId })
      : { state: "check" as const, reason: "The playbook could not be read just now." }];
  }));
  const weekAgo = now.getTime() - 7 * 86_400_000;
  const comments = links.filter((l) => !l.revokedAt).flatMap((l) => l.comments.filter((c) => Date.parse(c.createdAt) > weekAgo).map((c) => ({ ...c, draft: l.drafts.find((d) => d.postId === c.postId)?.text ?? "" })));
  const evidence = userId ? await sourceCards(userId, user.posts, user.channels) : [];
  const blocks = sourceHoldsFromCards(evidence);
  for (const [id, reason] of blocks) checks[id] = { state: "check", reason };
  const triage = triageFromBuffer({ channels: user.channels, posts: user.posts, now, timeZone: user.timeZone, checks, comments });
  return <><NeedsYouView needs={needs} readiness={readiness} greeting={`Signed in as ${user.email}`} triage={triage} live /><SourceEvidencePanel cards={evidence} timeZone={user.timeZone} /></>;
}
