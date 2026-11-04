import { redirect } from "next/navigation";
import { NeedsYouView, type NeedItem, type ReadinessItem } from "@/components/needs-you-view";
import { getCurrentUser } from "@/lib/current-user";

/** Example home, matching the example week used on the other screens. */
const EXAMPLE_NEEDS: NeedItem[] = [
  { id: "drafts", tone: "warning", title: "5 drafts to approve", detail: "Tue 27 and Thu 29, written from Weeknight Dinners 41 and 39", action: "Review", href: "/week" },
  { id: "rule", tone: "warning", title: "1 fix you made twice", detail: "On LinkedIn you cut “Excited to share” from the opening twice. Keep it as a rule?", action: "Decide", href: "/playbook" },
  { id: "willfail", tone: "danger", title: "1 post would fail", detail: "Wednesday's Substack post: Substack is disconnected in Buffer", action: "See the post", href: "/week" },
  { id: "failed", tone: "danger", title: "1 post did not go out", detail: "Wed 14 Oct, X 09:00: the image could not be loaded from its link", action: "See why", href: "/delivery" },
  { id: "empty", tone: "warning", title: "2 empty slots next week", detail: "Friday: LinkedIn at 12:00 and Threads at 16:00", action: "Write it", href: "/week?new=1" },
];

const EXAMPLE_READINESS: ReadinessItem[] = [
  { id: "buffer", label: "Buffer connected", state: "done", detail: "5 channels: LinkedIn, Instagram, Threads, Substack, X" },
  { id: "source", label: "Your newsletter added", state: "done", detail: "Weeknight Dinners feed" },
  { id: "voice", label: "Pick your voice", state: "done", detail: "5 of his own posts picked as examples" },
  { id: "ai", label: "Connect your AI", state: "done", detail: "Claude writes the drafts" },
  { id: "rules", label: "First rule kept", state: "todo", detail: "Fix drafts as usual. A fix you repeat becomes a rule", action: "Open playbook", href: "/playbook" },
];

/** The example account's home, opened from "Try the example". Someone signed in has their own home at `/`. */
export default async function ExamplePage() {
  const { user } = await getCurrentUser();
  if (user) redirect("/");
  return <NeedsYouView needs={EXAMPLE_NEEDS} readiness={EXAMPLE_READINESS} greeting="Good morning, Mark" />;
}
