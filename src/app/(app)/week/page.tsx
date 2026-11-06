import { sourceCards, sourceHoldsFromCards } from "@/lib/source-presentation";
import { postgresRulesStore } from "@/lib/rules-store";
import { draftReadiness, type Readiness } from "@/lib/draft-readiness";
import { playbookVersion } from "@/lib/playbook-version";
import { WeekView } from "@/components/week-view";
import { getCurrentUser } from "@/lib/current-user";
import { demoWeek } from "@/lib/demo-data";
import { countOpenSlots } from "@/lib/week-model";
import { exampleEvidence, exampleNotes, exampleRules, exampleTags, exampleWriting } from "@/lib/example-week-extras";
import { postsBetween } from "@/lib/posts-between";
import { nextWeekRange, weekFromBuffer } from "@/lib/week-from-buffer";
import { postgresWrittenStore } from "@/lib/written-store";
import { signedInUserId } from "@/lib/current-user";
import { writingAvailabilityFor } from "@/lib/writing-availability";
import { openSlots } from "@/lib/open-slots";
import { slotsToWrite } from "@/lib/write-week";

export default async function Page() {
  const { user } = await getCurrentUser();
  if (!user) {
    // The example shows the same week a signed-in person sees, with Alex's sample quotes, Notes, tags and rules.
    const ids = demoWeek.posts.filter((p) => p.status === "draft").map((p) => p.id);
    return <WeekView week={demoWeek} evidence={exampleEvidence} notesPreview={exampleNotes(ids)} tagsPreview={exampleTags(ids)} rules={exampleRules} writing={exampleWriting} writeCount={countOpenSlots(demoWeek)} />;
  }
  // One reference timezone for the week's columns: the first channel's, else the account's own in Buffer.
  const timeZone = user.timeZone;
  const now = new Date();
  const range = nextWeekRange(now, timeZone);
  const week = weekFromBuffer(user.channels, postsBetween(user.posts, range.start, range.end), range, timeZone);
  const userId = await signedInUserId();
  // The playbook verdicts each draft was saved with; a draft Queue Pilot did not write has none.
  const draftIds = week.posts.filter((p) => p.status === "draft").map((p) => p.id);
  const written = userId ? await postgresWrittenStore().get(userId, draftIds).catch(() => []) : [];
  const rules = userId ? await postgresRulesStore().list(userId).catch(() => null) : null;
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
  const blocks = sourceHoldsFromCards(evidence);
  for (const [id, reason] of blocks) readiness[id] = { state: "check", reason };
  const writing = userId ? await writingAvailabilityFor(userId) : undefined;
  const count = slotsToWrite(openSlots(user.channels, user.posts, user.range).slots, now, timeZone).length;
  return <WeekView week={week} evidence={evidence} live readiness={readiness} rules={rules ?? []} checkNotes={checkNotes} verdicts={verdicts} writing={writing} writeCount={count} />;
}
