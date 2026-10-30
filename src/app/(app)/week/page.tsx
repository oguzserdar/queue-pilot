import { WeekView } from "@/components/week-view";
import { getCurrentUser } from "@/lib/current-user";
import { demoWeek } from "@/lib/demo-data";
import { postsBetween } from "@/lib/posts-between";
import { nextWeekRange, weekFromBuffer } from "@/lib/week-from-buffer";
import { postgresWrittenStore } from "@/lib/written-store";
import { signedInUserId } from "@/lib/current-user";
import { writingAvailabilityFor } from "@/lib/writing-availability";
import { openSlots } from "@/lib/open-slots";
import { slotsToWrite } from "@/lib/write-week";

export default async function Page() {
  const { user } = await getCurrentUser();
  if (!user) return <WeekView week={demoWeek} />;
  // One reference timezone for the week's columns: the first channel's, else the account's own in Buffer.
  const timeZone = user.timeZone;
  const now = new Date();
  const range = nextWeekRange(now, timeZone);
  const week = weekFromBuffer(user.channels, postsBetween(user.posts, range.start, range.end), range, timeZone);
  const userId = await signedInUserId();
  // The playbook verdicts each draft was saved with; a draft Queue Pilot did not write has none.
  const draftIds = week.posts.filter((p) => p.status === "draft").map((p) => p.id);
  const written = userId ? await postgresWrittenStore().get(userId, draftIds).catch(() => []) : [];
  const verdicts = Object.fromEntries(written.map((w) => [w.postId, w.verdicts ?? null]));
  const writing = userId ? await writingAvailabilityFor(userId) : undefined;
  const count = slotsToWrite(openSlots(user.channels, user.posts, user.range).slots, now, timeZone).length;
  return <WeekView week={week} live verdicts={verdicts} writing={writing} writeCount={count} />;
}
