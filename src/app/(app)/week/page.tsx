import { sourceCards, sourceHoldsFromCards } from "@/lib/source-presentation";
import { postgresRulesStore } from "@/lib/rules-store";
import { draftReadiness, type Readiness } from "@/lib/draft-readiness";
import { playbookVersion } from "@/lib/playbook-version";
import { WeekView } from "@/components/week-view";
import { getCurrentUser } from "@/lib/current-user";
import { exampleWeekProps } from "@/lib/demo-week-props";
import { demoShiftDays } from "@/lib/demo-clock";
import { approverLine } from "@/lib/rule-origin";
import { postsBetween } from "@/lib/posts-between";
import { nextWeekRange, thisWeekRange, weekFromBuffer } from "@/lib/week-from-buffer";
import { postgresWrittenStore } from "@/lib/written-store";
import { readOr } from "@/lib/read-or";
import { signedInUserId } from "@/lib/current-user";
import { writingAvailabilityFor } from "@/lib/writing-availability";
import { openSlots } from "@/lib/open-slots";
import { slotsToWrite } from "@/lib/write-week";

export default async function Page({ searchParams }: { searchParams: Promise<{ w?: string }> }) {
  const { user } = await getCurrentUser();
  // ?w=this shows the week today is in, so a draft for the coming days can be read and approved; next week is the default.
  const which = (await searchParams).w === "this" ? "this" as const : "next" as const;
  if (!user) {
    // The example shows the same week a signed-in person sees, with Alex's sample quotes, Notes, tags and rules.
    // Always next week: the server works the shift out per visit (demo-clock.ts).
    return <WeekView {...exampleWeekProps(demoShiftDays())} />;
  }
  // One reference timezone for the week's columns: the first channel's, else the account's own in Buffer.
  const timeZone = user.timeZone;
  const now = new Date();
  const range = which === "this" ? thisWeekRange(now, timeZone) : nextWeekRange(now, timeZone);
  const week = weekFromBuffer(user.channels, postsBetween(user.posts, range.start, range.end), range, timeZone);
  const userId = await signedInUserId();
  // The playbook verdicts each draft was saved with; a draft Queue Pilot did not write has none.
  const draftIds = week.posts.filter((p) => p.status === "draft").map((p) => p.id);
  const written = userId ? await readOr(postgresWrittenStore().get(userId, draftIds), [], "week-written") : [];
  const rules = userId ? await readOr(postgresRulesStore().list(userId), null, "week-rules") : null;
  const revision = rules ? playbookVersion(rules) : null;
  const checkNotes = Object.fromEntries(written.map(w => [w.postId,
    week.posts.find(p => p.id === w.postId)?.text !== w.text ? "This draft changed since its last check. Check it again before relying on that result." :
    revision && w.playbookRevision !== revision ? "The rules or where they apply changed. This draft needs a fresh check." :
    "No current playbook check is available for this draft."]));
  const verdicts = Object.fromEntries(written.map((w) => [w.postId, revision && w.playbookRevision === revision && week.posts.find(p => p.id === w.postId)?.text === w.text ? w.verdicts ?? null : null]));
  const readiness: Record<string, Readiness> = Object.fromEntries(written.map(w => {
    const post = user.posts.find(p => p.id === w.postId);
    const network = user.channels.find(c => c.id === post?.channelId)?.service ?? w.network;
    return [w.postId, rules ? draftReadiness(w, post?.text ?? "", rules, { network, channelId: post?.channelId }) : { state: "check", reason: "The playbook could not be read. Try again." }];
  }));
  const evidence = userId ? await sourceCards(userId, user.posts, user.channels) : [];
  // The last approval recorded through Queue Pilot for each of its posts that left draft: the person in the app, or which AI app.
  const approved = userId ? await readOr(postgresWrittenStore().get(userId, week.posts.filter((p) => p.status !== "draft").map((p) => p.id)), [], "week-approvers") : [];
  const approvals = Object.fromEntries(approved.flatMap((w) => { const line = approverLine(w.approvedBy, w.approvedAt); return line ? [[w.postId, line]] : []; }));
  const blocks = sourceHoldsFromCards(evidence);
  for (const [id, reason] of blocks) readiness[id] = { state: "check", reason };
  const writing = userId ? await writingAvailabilityFor(userId) : undefined;
  // Fill next week always writes next week, so it is offered on that week only.
  const count = which === "next" ? slotsToWrite(openSlots(user.channels, user.posts, user.range).slots, now, timeZone).length : 0;
  return <WeekView which={which} week={week} evidence={evidence} live readiness={readiness} rules={rules ?? []} checkNotes={checkNotes} verdicts={verdicts} writing={which === "next" ? writing : undefined} writeCount={count} approvals={approvals} />;
}
