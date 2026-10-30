import type { ReadinessItem } from "@/components/needs-you-view";
import type { Channel } from "./buffer/queries";
import type { ApprovedApp } from "./ai-access";
import type { Source } from "./sources-store";
import type { Voice } from "./voice-store";
import { BUFFER_CHANNELS_URL } from "./connect-links";
/** Exact signed-in setup steps shown by Needs you. Approval stays a human step. */
export function setupReadiness(user: { channels: Channel[] }, sources: Source[], aiApps: ApprovedApp[] | null, voice: Voice | null): ReadinessItem[] {
  const n = user.channels.length;
  return [
    { id: "buffer", label: n > 0 ? "Channels in Buffer" : "No channels in your Buffer yet", state: n > 0 ? "done" : "todo", detail: n > 0 ? `${n} channel${n === 1 ? "" : "s"}: ${user.channels.map((c) => c.name).join(", ")}` : "Your Buffer account is connected, but it has 0 channels. Add LinkedIn, X or another network in Buffer, and Queue Pilot fills its empty times.", action: n > 0 ? undefined : "Add a channel", href: n > 0 ? undefined : BUFFER_CHANNELS_URL },
    // Done only once an app has really called Queue Pilot; an approval alone is not a working connection.
    aiApps?.some((a) => a.lastUsedAt)
      ? { id: "ai", label: "Connect your AI", state: "done", detail: aiApps.filter((a) => a.lastUsedAt).map((a) => a.name).join(", ") }
      : aiApps?.length
        ? { id: "ai", label: "Connect your AI", state: "todo", detail: `${aiApps.map((a) => a.name).join(", ")} approved, not used yet. Ask it to fill your week.`, action: "Connect", href: "/connect" }
        : { id: "ai", label: "Connect your AI", state: "todo", detail: "ChatGPT, Claude or Grok, on the plan you already pay for", action: "Connect", href: "/connect" },
    voice && voice.examples.length > 0
      ? { id: "voice", label: "Pick your voice", state: "done", detail: `${voice.examples.length} example post${voice.examples.length === 1 ? "" : "s"} picked` }
      : { id: "voice", label: "Pick your voice", state: "todo", detail: "Pick a few of your own posts so drafts sound like you", action: "Pick posts", href: "/voice" },
    sources.length > 0
      ? { id: "source", label: "Add one source", state: "done", detail: sources.map((x) => x.title).join(", ") }
      : { id: "source", label: "Add one source", state: "todo", detail: "Your newsletter, blog, YouTube or GitHub releases feed", action: "Add a feed", href: "/sources" },
    { id: "approve", label: "Approve your first draft", state: "todo", detail: "Your AI saves drafts in Buffer. Approve one and Buffer posts it at its time.", action: "Open week", href: "/week" },
  ];
}
