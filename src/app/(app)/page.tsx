import { sourceCards, sourceHoldsFromCards } from "@/lib/source-presentation";
import { SourceEvidencePanel } from "@/components/source-evidence";
import { NeedsYouView, type NeedItem, type ReadinessItem } from "@/components/needs-you-view";
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

/** Example home, matching the example week used on the other screens. */
const EXAMPLE_NEEDS: NeedItem[] = [
  { id: "drafts", tone: "warning", title: "4 drafts to approve", detail: "Tue 3 to Thu 5, written from This Week in AI 41 and 40", action: "Review", href: "/week" },
  { id: "rule", tone: "warning", title: "1 fix you made twice", detail: "On Instagram you replaced a feeling with the result. Keep it as a rule?", action: "Decide", href: "/playbook" },
  { id: "willfail", tone: "danger", title: "1 post would fail", detail: "Wednesday's Threads post: Threads is disconnected in Buffer", action: "See the post", href: "/week" },
  { id: "failed", tone: "danger", title: "1 post did not go out", detail: "Wed 28 Oct, X 09:00: the image could not be loaded from its link", action: "See why", href: "/delivery" },
  { id: "empty", tone: "warning", title: "1 empty slot next week", detail: "Friday, LinkedIn at 12:00", action: "Write it", href: "/week?new=1" },
];

const EXAMPLE_READINESS: ReadinessItem[] = [
  { id: "buffer", label: "Buffer connected", state: "done", detail: "4 channels: LinkedIn, Instagram, Threads, X" },
  { id: "source", label: "Your newsletter added", state: "done", detail: "This Week in AI feed" },
  { id: "voice", label: "Pick your voice", state: "done", detail: "5 of Alex's own posts picked as examples" },
  { id: "ai", label: "Connect your AI", state: "done", detail: "Claude writes the drafts" },
  { id: "rules", label: "First rule kept", state: "todo", detail: "Fix drafts as usual. A fix you repeat becomes a rule", action: "Open playbook", href: "/playbook" },
];

export default async function Page() {
  const { user } = await getCurrentUser();
  if (!user) return <NeedsYouView needs={EXAMPLE_NEEDS} readiness={EXAMPLE_READINESS} greeting="Good morning, Alex" />;
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
