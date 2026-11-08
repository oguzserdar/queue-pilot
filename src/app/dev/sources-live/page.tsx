import { channels as exampleChannels } from "@/lib/example-channels";
import { notFound } from "next/navigation";
import { AppShell, type ShellAccount } from "@/components/app-shell";
import { SourcesView } from "@/components/sources-view";

/** Development only: the signed-in Sources screen with example data, for screenshots. Production answers 404. */
export default async function Page({ searchParams }: { searchParams: Promise<{ connected?: string }> }) {
  if (process.env.NODE_ENV === "production") notFound();
  const connected = (await searchParams).connected === "1";
  const account: ShellAccount = { email: "alex@thisweekinai.example", channels: exampleChannels.slice(0, 3).map(c => ({ ...c, name: c.handle })), fetchedAt: new Date(Date.now() - 3 * 60_000).toISOString(), needsRefresh: false, name: "Alex Rivera", image: null };
  return (
    <AppShell account={account} signInOpen>
      <SourcesView
        mode="live"
        connectorUrl="https://queue-pilot.example/api/mcp"
        channels={[
          { id: "x", name: "X", service: "twitter", isDisconnected: false, isLocked: false, isQueuePaused: false },
          { id: "li", name: "LinkedIn", service: "linkedin", isDisconnected: false, isLocked: false, isQueuePaused: false },
          { id: "bs", name: "Bluesky", service: "bluesky", isDisconnected: true, isLocked: false, isQueuePaused: false },
        ]}
        sources={[
          { id: "s1", title: "This Week in AI", url: "https://thisweekinai.example/feed" },
          { id: "s2", title: "This Week in AI on YouTube", url: "https://www.youtube.com/feeds/videos.xml?channel_id=UCthisweekinai" },
        ]}
        copies={connected ? [{ kind: "telegram", label: "This Week in AI news" }, { kind: "discord", label: "This Week in AI #new-issues" }] : []}
        discordResult={null}
        loadTargets={sampleTargets}
        announcements={connected ? [
          { announcementId: "d1", kind: "discord", label: "QP test #announcements", text: "Patch 1.4 is out. Exports now resume after a dropped connection.", status: "sent", link: "https://discord.com/channels/1/2/3", error: null, at: new Date(Date.now() - 600_000).toISOString() },
          { announcementId: "d1", kind: "telegram", label: "QueuePilot", text: "Patch 1.4: exports resume after a dropped connection.", status: "uncertain", link: null, error: "No answer in time, so it may have been sent. Check the channel.", at: new Date(Date.now() - 600_000).toISOString() },
          { announcementId: "d0", kind: "discord", label: "QP test #general", text: "Maintenance tonight from 22:00 UTC.", status: "failed", link: null, error: "Missing Permissions", at: new Date(Date.now() - 86_400_000).toISOString() },
        ] : []}
      />
    </AppShell>
  );
}

/** Sample places for checking the announcement form in development: one Discord channel the bot cannot post in. */
async function sampleTargets() {
  "use server";
  return {
    telegram: { label: "QueuePilot", limit: 4096 },
    discord: { label: "QP test", limit: 2000, defaultId: "c1", channels: [{ id: "c1", name: "announcements", canPost: true }, { id: "c2", name: "general", canPost: true }, { id: "c3", name: "staff-only", canPost: false }] },
  };
}
