import type { ReadinessItem } from "@/components/needs-you-view";
import type { Channel } from "./buffer/queries";
import type { ApprovedApp } from "./ai-access";
import type { Source } from "./sources-store";
import type { Voice } from "./voice-store";
import { BUFFER_CHANNELS_URL } from "./connect-links";
/**
 * Exact signed-in setup steps shown by Needs you. Approval stays a human step.
 *
 * @param approved - Whether the person has approved a draft Queue Pilot wrote, which completes the last step
 * @param direct - Without Buffer: the handles of the Mastodon and Bluesky accounts connected to Queue Pilot itself
 */
export function setupReadiness(user: { channels: Channel[]; noBuffer?: boolean }, sources: Source[], aiApps: ApprovedApp[] | null, voice: Voice | null, approved = false, direct: string[] = []): ReadinessItem[] {
  return [
    user.noBuffer ? directItem(direct) : bufferItem(user.channels),
    aiItem(aiApps),
    voiceItem(voice),
    sourceItem(sources),
    approveItem(Boolean(user.noBuffer), approved),
  ];
}

/** Without Buffer: the Mastodon and Bluesky accounts connected to Queue Pilot itself. */
function directItem(direct: string[]): ReadinessItem {
  return direct.length
    ? { id: "buffer", label: "Accounts connected", state: "done", detail: direct.join(", ") }
    : { id: "buffer", label: "Connect where you post", state: "todo", detail: "Mastodon or Bluesky, straight from Queue Pilot. Or sign in with Buffer to use your Buffer channels.", action: "Connect an account", href: "/settings?tab=channels" };
}

/** The channels in the person's Buffer. */
function bufferItem(channels: Channel[]): ReadinessItem {
  const n = channels.length;
  return { id: "buffer", label: n > 0 ? "Channels in Buffer" : "No channels in your Buffer yet", state: n > 0 ? "done" : "todo", detail: n > 0 ? `${n} channel${n === 1 ? "" : "s"}: ${channels.map((c) => c.name).join(", ")}` : "Your Buffer account is connected, but it has 0 channels. Add LinkedIn, X or another network in Buffer, and Queue Pilot fills its empty times.", action: n > 0 ? undefined : "Add a channel", href: n > 0 ? undefined : BUFFER_CHANNELS_URL };
}

/** Done only once an app has really called Queue Pilot; an approval alone is not a working connection. */
function aiItem(aiApps: ApprovedApp[] | null): ReadinessItem {
  if (aiApps?.some((a) => a.lastUsedAt)) return { id: "ai", label: "AI connected", state: "done", detail: aiApps.filter((a) => a.lastUsedAt).map((a) => a.name).join(", ") };
  if (aiApps?.length) return { id: "ai", label: "Connect your AI", state: "todo", detail: `${aiApps.map((a) => a.name).join(", ")} approved, not used yet. Ask it to fill your week.`, action: "Connect", href: "/connect" };
  return { id: "ai", label: "Connect your AI", state: "todo", detail: "ChatGPT, Claude or Grok, on the plan you already pay for", action: "Connect", href: "/connect" };
}

/** The example posts the person picked for their voice. */
function voiceItem(voice: Voice | null): ReadinessItem {
  return voice && voice.examples.length > 0
    ? { id: "voice", label: "Voice picked", state: "done", detail: `${voice.examples.length} example post${voice.examples.length === 1 ? "" : "s"} picked` }
    : { id: "voice", label: "Pick your voice", state: "todo", detail: "Pick a few of your own posts so drafts sound like you", action: "Pick posts", href: "/voice" };
}

/** The sources drafts are written from. */
function sourceItem(sources: Source[]): ReadinessItem {
  return sources.length > 0
    ? { id: "source", label: "Source added", state: "done", detail: sources.map((x) => x.title).join(", ") }
    : { id: "source", label: "Add one source", state: "todo", detail: "Your newsletter, blog, YouTube or GitHub releases feed", action: "Add a feed", href: "/sources" };
}

/** The last step: without Buffer, planning a post; with Buffer, approving a draft. Approval stays a human step. */
function approveItem(noBuffer: boolean, approved: boolean): ReadinessItem {
  if (noBuffer && !approved) return { id: "approve", label: "Plan your first post", state: "todo", detail: "Set posting times on an account, then write a post for an empty time in Next week. Queue Pilot posts it at that time.", action: "Open week", href: "/week" };
  if (approved) return { id: "approve", label: "Approve your first draft", state: "done", detail: "You approved a draft, and Buffer posts it at its time." };
  return { id: "approve", label: "Approve your first draft", state: "todo", detail: "Your AI saves drafts in Buffer. Approve one and Buffer posts it at its time.", action: "Open week", href: "/week" };
}
