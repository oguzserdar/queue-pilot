import { sourceCards, sourceHoldsFromCards } from "@/lib/source-presentation";
import { SourceEvidencePanel } from "@/components/source-evidence";
import { NeedsYouView, type ReadinessItem } from "@/components/needs-you-view";
import { setupReadiness } from "@/lib/setup-readiness";
import { approvedAiApps, getCurrentUser, signedInUserId } from "@/lib/current-user";
import { postgresSourceStore } from "@/lib/sources-store";
import { postgresVoiceStore } from "@/lib/voice-store";
import { needsFromBuffer } from "@/lib/needs-model";
import { triageFromBuffer } from "@/lib/triage-model";
import { draftReadiness, type Readiness } from "@/lib/draft-readiness";
import { hasApprovedDraft, postgresWrittenStore } from "@/lib/written-store";
import { postgresRulesStore } from "@/lib/rules-store";
import { postgresReviewStore } from "@/lib/review-store";
import { waitingRepeats } from "@/lib/read-back";
import { demoShiftDays } from "@/lib/demo-clock";
import { exampleNeeds } from "@/lib/example-needs";


const EXAMPLE_READINESS: ReadinessItem[] = [
  { id: "buffer", label: "Buffer connected", state: "done", detail: "3 of 4 channels: LinkedIn, Instagram, X. Threads is disconnected" },
  { id: "source", label: "Your newsletter added", state: "done", detail: "This Week in AI feed" },
  { id: "voice", label: "Voice picked", state: "done", detail: "3 of Alex's own posts picked as examples" },
  { id: "ai", label: "AI connected", state: "done", detail: "Claude writes the drafts" },
  { id: "rules", label: "First rule kept", state: "todo", detail: "Fix drafts as usual. A fix you repeat becomes a rule", action: "Open playbook", href: "/playbook" },
];

import { HomeStart } from "@/components/home-start";
import { AiOffer } from "@/components/ai-offer";
import { WelcomeChoice } from "@/components/welcome-choice";
import { dismissedOffers } from "@/lib/offer-store";
import { headers } from "next/headers";
import { publicOrigin } from "@/lib/origin";
import { openSlots } from "@/lib/open-slots";
import { emptyTimesAhead, slotsToWrite } from "@/lib/write-week";
import { writingAvailabilityFor } from "@/lib/writing-availability";
export default async function Page() {
  const { user } = await getCurrentUser();
  if (!user) return <NeedsYouView needs={exampleNeeds(demoShiftDays())} readiness={EXAMPLE_READINESS} greeting="Hi, Alex" />;
  // Signed in: only facts the Buffer snapshot and the user's saved feeds back.
  const userId = await signedInUserId();
  const [sources, aiApps, voice, approved] = await Promise.all([userId ? postgresSourceStore().list(userId) : [], approvedAiApps(), userId ? postgresVoiceStore().get(userId) : null, userId ? hasApprovedDraft(userId).catch(() => false) : false]);
  const readiness = setupReadiness(user, sources, aiApps, voice, approved);
  const needs = needsFromBuffer(user.channels, user.posts, new Date(), user.timeZone);
  const now = new Date();
  // Each draft Queue Pilot wrote, with how it did against the current playbook.
  const draftIds = user.posts.filter((p) => p.status === "draft").map((p) => p.id);
  const [written, rules, links, repeats] = await Promise.all([
    userId ? postgresWrittenStore().get(userId, draftIds).catch(() => []) : [],
    userId ? postgresRulesStore().list(userId).catch(() => null) : null,
    userId ? postgresReviewStore().list(userId).catch(() => []) : [],
    // Fixes the person repeated, found for free; the Playbook asks the model whether each is a lasting preference.
    userId ? waitingRepeats(userId).catch(() => []) : [],
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
  const triage = triageFromBuffer({ channels: user.channels, posts: user.posts, now, timeZone: user.timeZone, checks, comments, repeats });
  // Until Queue Pilot has written a draft for the week shown, Home leads with the shortest way to the first ones.
  const open = openSlots(user.channels, user.posts, user.range).slots;
  const toFill = slotsToWrite(open, now, user.timeZone).length;
  const emptyAhead = emptyTimesAhead(open, now, user.timeZone);
  // An AI counts as connected once it has really called Queue Pilot, not when its approval was granted.
  const connected = [...new Set((aiApps ?? []).filter((a) => a.lastUsedAt).sort((a, b) => b.lastUsedAt!.localeCompare(a.lastUsedAt!)).map((a) => a.brand ?? a.name))];
  const setAside = userId ? await dismissedOffers(userId).catch((e) => { console.warn(JSON.stringify({ event: "qp-offers-read-failed", message: e instanceof Error ? e.message : String(e) })); return new Set(); }) : new Set();
  // First visit: nothing connected, no link, nothing written yet. Home opens on who should write the drafts.
  const firstVisit = !!userId && connected.length === 0 && sources.length === 0 && written.length === 0 && toFill > 0 && !setAside.has("welcome");
  const offerKey = connected.length ? "add-ai" : "connect-ai";
  const offer = !firstVisit && userId && !setAside.has(offerKey) ? <AiOffer connected={connected} /> : null;
  const firstDrafts = userId && written.length === 0 && toFill > 0;
  const start = firstVisit
    ? <WelcomeChoice origin={publicOrigin(await headers())} approved={aiApps} count={toFill} total={emptyAhead} empty={triage.find((t) => t.kind === "empty")?.count ?? emptyAhead} hasSource={sources.length > 0} writing={await writingAvailabilityFor(userId)}
        account={{ email: user.email, channels: user.channels.map((c) => ({ name: c.name, service: c.service, disconnected: c.isDisconnected })) }} />
    : (offer || firstDrafts) ? <>{offer}{firstDrafts ? <HomeStart hasSource={sources.length > 0} writing={await writingAvailabilityFor(userId!)} count={toFill} total={emptyAhead} aiLink={!offer && connected.length === 0} ai={connected[0]} /> : null}</> : undefined;
  return <><NeedsYouView needs={needs} readiness={readiness} greeting={`Signed in as ${user.email}`} triage={triage} live start={start} welcome={firstVisit} /><SourceEvidencePanel cards={evidence} timeZone={user.timeZone} /></>;
}
