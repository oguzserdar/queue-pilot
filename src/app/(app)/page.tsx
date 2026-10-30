import { NeedsYouView, type NeedItem, type ReadinessItem } from "@/components/needs-you-view";
import { setupReadiness } from "@/lib/setup-readiness";
import { approvedAiApps, getCurrentUser, signedInUserId } from "@/lib/current-user";
import { postgresSourceStore } from "@/lib/sources-store";
import { postgresVoiceStore } from "@/lib/voice-store";
import { needsFromBuffer } from "@/lib/needs-model";

/** Example home, matching the example week used on the other screens. */
const EXAMPLE_NEEDS: NeedItem[] = [
  { id: "drafts", tone: "warning", title: "4 drafts to approve", detail: "Tue 27 and Thu 29, written from Weeknight Dinners 41 and 39", action: "Review", href: "/week" },
  { id: "rule", tone: "warning", title: "1 fix you made twice", detail: "On Instagram you replaced a feeling with the dish. Keep it as a rule?", action: "Decide", href: "/playbook" },
  { id: "willfail", tone: "danger", title: "1 post would fail", detail: "Wednesday's Bluesky post: Bluesky is disconnected in Buffer", action: "See the post", href: "/week" },
  { id: "failed", tone: "danger", title: "1 post did not go out", detail: "Wed 14 Oct, X 09:00: the image could not be loaded from its link", action: "See why", href: "/delivery" },
  { id: "empty", tone: "warning", title: "1 empty slot next week", detail: "Friday, LinkedIn at 12:00", action: "Write it", href: "/week?new=1" },
];

const EXAMPLE_READINESS: ReadinessItem[] = [
  { id: "buffer", label: "Buffer connected", state: "done", detail: "4 channels: LinkedIn, Instagram, Bluesky, X" },
  { id: "source", label: "Your newsletter added", state: "done", detail: "Weeknight Dinners feed" },
  { id: "voice", label: "Pick your voice", state: "done", detail: "5 of his own posts picked as examples" },
  { id: "ai", label: "Connect your AI", state: "done", detail: "Claude writes the drafts" },
  { id: "rules", label: "First rule kept", state: "todo", detail: "Fix drafts as usual. A fix you repeat becomes a rule", action: "Open playbook", href: "/playbook" },
];

export default async function Page() {
  const { user } = await getCurrentUser();
  if (!user) return <NeedsYouView needs={EXAMPLE_NEEDS} readiness={EXAMPLE_READINESS} greeting="Good morning, Mark" />;
  // Signed in: only facts the Buffer snapshot and the user's saved feeds back.
  const userId = await signedInUserId();
  const [sources, aiApps, voice] = await Promise.all([userId ? postgresSourceStore().list(userId) : [], approvedAiApps(), userId ? postgresVoiceStore().get(userId) : null]);
  const readiness = setupReadiness(user, sources, aiApps, voice);
  const needs = needsFromBuffer(user.channels, user.posts, new Date(), user.timeZone);
  return <NeedsYouView needs={needs} readiness={readiness} greeting={`Signed in as ${user.email}`} />;
}
