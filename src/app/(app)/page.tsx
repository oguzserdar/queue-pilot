import { listSocialAccounts } from "@/lib/social-accounts";
import { readOr } from "@/lib/read-or";
import { sourceCards, sourceHoldsFromCards } from "@/lib/source-presentation";
import { SourceEvidencePanel } from "@/components/source-evidence";
import { NeedsYouView, type ReadinessItem } from "@/components/needs-you-view";
import { setupReadiness } from "@/lib/setup-readiness";
import { approvedAiApps, getCurrentUser, signedInUserId } from "@/lib/current-user";
import { postgresSourceStore } from "@/lib/sources-store";
import { postgresVoiceStore } from "@/lib/voice-store";
import { needsFromBuffer } from "@/lib/needs-model";
import { triageFromBuffer } from "@/lib/triage-model";
import { pulledBackFor } from "@/lib/pulled-back";
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
import type { ReactNode } from "react";
import type { ApprovedApp } from "@/lib/ai-access";

type User = NonNullable<Awaited<ReturnType<typeof getCurrentUser>>["user"]>;
type Written = Awaited<ReturnType<ReturnType<typeof postgresWrittenStore>["get"]>>;
type Rules = Awaited<ReturnType<ReturnType<typeof postgresRulesStore>["list"]>>;
type Links = Awaited<ReturnType<ReturnType<typeof postgresReviewStore>["list"]>>;

/** Each draft Queue Pilot wrote, with how it did against the current playbook: the same test Approve uses. */
function draftChecks(user: User, written: Written, rules: Rules | null): Record<string, Readiness> {
  const postsById = new Map(user.posts.map(p => [p.id, p]));
  const channelsById = new Map(user.channels.map(c => [c.id, c]));
  return Object.fromEntries(written.map(w => {
    const post = postsById.get(w.postId);
    const network = post ? channelsById.get(post.channelId)?.service ?? w.network : w.network;
    return [w.postId, rules
      ? draftReadiness(w, post?.text ?? "", rules, { network, channelId: post?.channelId })
      : { state: "check" as const, reason: "The playbook could not be read just now." }];
  }));
}

/** Review comments from the last seven days on links still on, each with the draft it was left on. */
function recentComments(links: Links, now: Date) {
  const weekAgo = now.getTime() - 7 * 86_400_000;
  return links.filter((l) => !l.revokedAt).flatMap((l) => l.comments.filter((c) => Date.parse(c.createdAt) > weekAgo).map((c) => ({ ...c, draft: l.drafts.find((d) => d.postId === c.postId)?.text ?? "" })));
}

/** The AI apps that have really called Queue Pilot (not only been approved), most recent first, by name. */
function connectedAis(apps: ApprovedApp[] | null): string[] {
  const used = (apps ?? []).flatMap((a) => (a.lastUsedAt ? [{ app: a, at: a.lastUsedAt }] : []));
  return [...new Set(used.sort((a, b) => b.at.localeCompare(a.at)).map(({ app }) => app.brand ?? app.name))];
}

/** What leads home before the list: the first visit's choice, an offer to connect an AI, and the way to the first drafts. */
async function homeStart(p: { user: User; userId: string; aiApps: ApprovedApp[] | null; hasSource: boolean; firstVisit: boolean; setAside: Set<string>; written: number; toFill: number; emptyAhead: number; empty: number; connected: string[] }): Promise<ReactNode> {
  const { user, userId } = p;
  const offerKey = p.connected.length ? "add-ai" : "connect-ai";
  const offer = !p.firstVisit && !p.setAside.has(offerKey) ? <AiOffer connected={p.connected} /> : null;
  const firstDrafts = p.written === 0 && p.toFill > 0;
  if (p.firstVisit) {
    return <WelcomeChoice origin={publicOrigin(await headers())} approved={p.aiApps} count={p.toFill} total={p.emptyAhead} empty={p.empty} hasSource={p.hasSource} writing={await writingAvailabilityFor(userId)}
      account={{ email: user.email, channels: user.channels.map((c) => ({ name: c.name, service: c.service, disconnected: c.isDisconnected })) }} />;
  }
  if (!offer && !firstDrafts) return undefined;
  return <>{offer}{firstDrafts ? <HomeStart hasSource={p.hasSource} writing={await writingAvailabilityFor(userId)} count={p.toFill} total={p.emptyAhead} aiLink={!offer && p.connected.length === 0} ai={p.connected[0]} /> : null}</>;
}

/** Everything Home reads for a signed-in person; each part that fails falls back to empty, as the page always did. */
async function homeReads(userId: string, user: User) {
  const draftIds = user.posts.filter((p) => p.status === "draft").map((p) => p.id);
  const [sources, voice, approved, direct, written, rules, links, repeats, evidence, setAside] = await Promise.all([
    postgresSourceStore().list(userId),
    postgresVoiceStore().get(userId),
    hasApprovedDraft(userId).catch(() => false),
    user.noBuffer ? readOr(listSocialAccounts(userId), [], "home-direct-accounts").then((l) => l.map((a) => a.handle)) : [],
    // Each draft Queue Pilot wrote, with how it did against the current playbook.
    postgresWrittenStore().get(userId, draftIds).catch(() => []),
    postgresRulesStore().list(userId).catch(() => null),
    postgresReviewStore().list(userId).catch(() => []),
    // Fixes the person repeated, found for free; the Playbook asks the model whether each is a lasting preference.
    waitingRepeats(userId).catch(() => []),
    sourceCards(userId, user.posts, user.channels),
    dismissedOffers(userId).catch((e): Set<string> => { console.warn(JSON.stringify({ event: "qp-offers-read-failed", message: e instanceof Error ? e.message : String(e) })); return new Set(); }),
  ]);
  const pulledBack = [...await pulledBackFor(userId, written, user.posts).catch(() => new Set<string>())];
  return { sources, voice, approved, direct, written, rules, links, repeats, evidence, setAside, pulledBack };
}

// Signed out there is no voice to read, so the reads allow none.
type HomeReads = Omit<Awaited<ReturnType<typeof homeReads>>, "voice"> & { voice: Awaited<ReturnType<typeof homeReads>>["voice"] | null };
const SIGNED_OUT_READS: HomeReads = { sources: [], voice: null, approved: false, direct: [], written: [], rules: null, links: [], repeats: [], evidence: [], setAside: new Set(), pulledBack: [] };

export default async function Page() {
  const { user } = await getCurrentUser();
  if (!user) return <NeedsYouView needs={exampleNeeds(demoShiftDays())} readiness={EXAMPLE_READINESS} greeting="Hi, Alex" />;
  // Signed in: only facts the Buffer snapshot and the user's saved feeds back.
  const userId = await signedInUserId();
  const [aiApps, r] = await Promise.all([approvedAiApps(), userId ? homeReads(userId, user) : SIGNED_OUT_READS]);
  const readiness = setupReadiness(user, r.sources, aiApps, r.voice, r.approved, r.direct);
  const needs = needsFromBuffer(user.channels, user.posts, new Date(), user.timeZone);
  const now = new Date();
  // The same test Approve uses, so this page never offers an approval the button would refuse.
  const checks = draftChecks(user, r.written, r.rules);
  for (const [id, reason] of sourceHoldsFromCards(r.evidence)) checks[id] = { state: "check", reason };
  const triage = triageFromBuffer({ channels: user.channels, posts: user.posts, now, timeZone: user.timeZone, checks, comments: recentComments(r.links, now), repeats: r.repeats, pulledBack: r.pulledBack });
  // Until Queue Pilot has written a draft for the week shown, Home leads with the shortest way to the first ones.
  const open = openSlots(user.channels, user.posts, user.range).slots;
  const toFill = slotsToWrite(open, now, user.timeZone).length;
  const emptyAhead = emptyTimesAhead(open, now, user.timeZone);
  // An AI counts as connected once it has really called Queue Pilot, not when its approval was granted.
  const connected = connectedAis(aiApps);
  // First visit: nothing connected, no link, nothing written yet. Home opens on who should write the drafts.
  const firstVisit = !!userId && connected.length === 0 && r.sources.length === 0 && r.written.length === 0 && toFill > 0 && !r.setAside.has("welcome");
  const start = userId ? await homeStart({ user, userId, aiApps, hasSource: r.sources.length > 0, firstVisit, setAside: r.setAside, written: r.written.length, toFill, emptyAhead, empty: triage.find((t) => t.kind === "empty")?.count ?? emptyAhead, connected }) : undefined;
  return <><NeedsYouView needs={needs} readiness={readiness} greeting={`Signed in as ${user.email}`} triage={triage} live start={start} welcome={firstVisit} noBuffer={user.noBuffer} /><SourceEvidencePanel cards={r.evidence} timeZone={user.timeZone} /></>;
}
