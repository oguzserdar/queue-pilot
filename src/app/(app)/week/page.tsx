import { sourceCards, sourceHoldsFromCards } from "@/lib/source-presentation";
import { pulledBackFor } from "@/lib/pulled-back";
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
import { checkedTextOf } from "@/lib/checked-text";
import { readOr } from "@/lib/read-or";
import { signedInUserId } from "@/lib/current-user";
import { writingAvailabilityFor } from "@/lib/writing-availability";
import { openSlots } from "@/lib/open-slots";
import { emptyTimesAhead, slotsToWrite } from "@/lib/write-week";
import { postgresFillDraftStore } from "@/lib/fill-draft-store";
import { recoverFillDrafts } from "@/lib/fill-recovery";
import { directChannels } from "@/lib/posting-times";
import { postgresDirectPostStore } from "@/lib/direct-post-store";
import { directWeekPosts } from "@/lib/direct-week";

type WrittenDraft = Awaited<ReturnType<ReturnType<typeof postgresWrittenStore>["get"]>>[number];

/** Why a draft has no current check to show: its text changed, the playbook changed, or no check is available. */
function checkNote(w: WrittenDraft, text: string | undefined, revision: string | null): string {
  if (text !== checkedTextOf(w)) return "This draft changed since its last check. Check it again before relying on that result.";
  if (revision && w.playbookRevision !== revision) return "The rules or where they apply changed. This draft needs a fresh check.";
  return "No current playbook check is available for this draft.";
}

export default async function Page({ searchParams }: { searchParams: Promise<{ w?: string }> }) {
  const { user } = await getCurrentUser();
  // ?w=this shows the week today is in, so a draft for the coming days can be read and approved; next week is the default.
  const which = (await searchParams).w === "this" ? "this" as const : "next" as const;
  if (!user) {
    // The example shows the same week a signed-in person sees, with Alex's sample quotes, Notes, tags and rules.
    // Always next week: the server works the shift out per visit (demo-clock.ts).
    return <WeekView {...exampleWeekProps(demoShiftDays())} />;
  }
  const userId = await signedInUserId();
  // Mastodon and Bluesky accounts Queue Pilot posts to itself are rows of the same week, with their own posting times.
  const direct = userId ? await readOr(directChannels(userId), [], "week-direct-channels") : [];
  // One reference timezone for the week's columns: the first Buffer channel's, else the account's own in Buffer;
  // without Buffer, the first direct account's that has posting times.
  const timeZone = user.noBuffer ? direct.find((c) => c.postingSchedule.length)?.timezone ?? user.timeZone : user.timeZone;
  const now = new Date();
  const range = which === "this" ? thisWeekRange(now, timeZone) : nextWeekRange(now, timeZone);
  const directPosts = userId && direct.length ? directWeekPosts(await readOr(postgresDirectPostStore().between(userId, range.start, range.end), [], "week-direct-posts")) : [];
  // A direct account is a row only once it has posting times or a post this week, so connecting one for replies
  // never adds an empty row to someone's week.
  const shown = direct.filter((c) => c.postingSchedule.length > 0 || directPosts.some((p) => p.channelId === c.id));
  const week = weekFromBuffer([...user.channels, ...shown], [...postsBetween(user.posts, range.start, range.end), ...directPosts], range, timeZone);
  // The playbook verdicts each draft was saved with; a draft Queue Pilot did not write has none.
  const draftIds = week.posts.filter((p) => p.status === "draft").map((p) => p.id);
  const written = userId ? await readOr(postgresWrittenStore().get(userId, draftIds), [], "week-written") : [];
  const rules = userId ? await readOr(postgresRulesStore().list(userId), null, "week-rules") : null;
  // Posts the person took off the schedule in Buffer: left out of Approve all, approved only on their own card.
  const pulledBack = userId ? [...await readOr(pulledBackFor(userId, written, week.posts), new Set<string>(), "week-pulled-back")] : [];
  const revision = rules ? playbookVersion(rules) : null;
  const checkNotes = Object.fromEntries(written.map(w => [w.postId, checkNote(w, week.posts.find(p => p.id === w.postId)?.text, revision)]));
  const verdicts = Object.fromEntries(written.map((w) => [w.postId, revision && w.playbookRevision === revision && week.posts.find(p => p.id === w.postId)?.text === checkedTextOf(w) ? w.verdicts ?? null : null]));
  const readiness: Record<string, Readiness> = Object.fromEntries(written.map(w => {
    const post = user.posts.find(p => p.id === w.postId);
    const network = user.channels.find(c => c.id === post?.channelId)?.service ?? w.network;
    return [w.postId, rules ? draftReadiness(w, post?.text ?? "", rules, { network, channelId: post?.channelId }) : { state: "check", reason: "The playbook could not be read. Try again." }];
  }));
  // A fill that stopped, or whose Buffer save never answered, is settled against the queue as last read. Time is
  // measured from that read, so a copy fetched before the save landed never marks a saved draft as failed.
  if (userId) {
    const fills = postgresFillDraftStore();
    await recoverFillDrafts(userId, user.posts, (channelId) => user.channels.find((c) => c.id === channelId)?.service ?? "", { open: (...a: Parameters<typeof fills.open>) => fills.open(...a), settle: (...a: Parameters<typeof fills.settle>) => fills.settle(...a), record: (id, drafts) => postgresWrittenStore().record(id, drafts) }, user.fetchedAt)
      .catch((e) => console.error(JSON.stringify({ event: "qp-fill-recovery-failed", message: e instanceof Error ? e.message : String(e) })));
  }
  const evidence = userId ? await sourceCards(userId, user.posts, user.channels) : [];
  // The last approval recorded through Queue Pilot for each of its posts that left draft: the person in the app, or which AI app.
  const approved = userId ? await readOr(postgresWrittenStore().get(userId, week.posts.filter((p) => p.status !== "draft").map((p) => p.id)), [], "week-approvers") : [];
  const approvals = Object.fromEntries(approved.flatMap((w) => { const line = approverLine(w.approvedBy, w.approvedAt); return line ? [[w.postId, line]] : []; }));
  const blocks = sourceHoldsFromCards(evidence);
  for (const [id, reason] of blocks) readiness[id] = { state: "check", reason };
  const writing = userId ? await writingAvailabilityFor(userId) : undefined;
  // How many drafts one press would write into the week shown: its empty times still ahead, at most ten.
  const open = openSlots(user.channels, user.posts, user.range).slots;
  const count = slotsToWrite(open, now, timeZone, undefined, which).length;
  const writeTotal = emptyTimesAhead(open, now, timeZone, which);
  return <WeekView noBuffer={user.noBuffer} which={which} nowIso={now.toISOString()} week={week} evidence={evidence} live readiness={readiness} rules={rules ?? []} checkNotes={checkNotes} verdicts={verdicts} pulledBack={pulledBack} writing={writing} writeCount={count} writeTotal={writeTotal} approvals={approvals} />;
}
