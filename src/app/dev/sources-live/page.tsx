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
          { id: "th", name: "Threads", service: "threads", isDisconnected: true, isLocked: false, isQueuePaused: false },
        ]}
        sources={[
          { id: "s1", title: "This Week in AI", url: "https://thisweekinai.example/feed" },
          { id: "s2", title: "This Week in AI on YouTube", url: "https://www.youtube.com/feeds/videos.xml?channel_id=UCthisweekinai" },
        ]}
        copies={connected ? [{ kind: "telegram", label: "This Week in AI news" }, { kind: "discord", label: "This Week in AI #new-issues" }] : []}
        discordResult={null}
        loadTargets={sampleTargets}
        posts={connected ? [
          { postId: "d2", kind: "discord", label: "This Week in AI #new-issues", text: "Patch 1.5 goes out Monday. Back up your exports first.", status: "scheduled", link: null, error: null, at: new Date().toISOString(), sendAt: new Date(Date.now() + 26 * 3_600_000).toISOString(), late: false, followsBuffer: false },
          { postId: "d2", kind: "telegram", label: "This Week in AI", text: "Patch 1.5 goes out Monday. Back up your exports first.", status: "scheduled", link: null, error: null, at: new Date().toISOString(), sendAt: new Date(Date.now() + 26 * 3_600_000).toISOString(), late: false, followsBuffer: false },
          { postId: "d1", kind: "discord", label: "This Week in AI #new-issues", text: "Patch 1.4 is out. Exports now resume after a dropped connection.", status: "sent", link: "https://discord.com/channels/1/2/3", error: null, at: new Date(Date.now() - 600_000).toISOString(), sendAt: null, late: false, followsBuffer: false },
          { postId: "d1", kind: "telegram", label: "This Week in AI", text: "Patch 1.4: exports resume after a dropped connection.", status: "uncertain", link: null, error: "No answer in time, so it may have been sent. Check the channel.", at: new Date(Date.now() - 600_000).toISOString(), sendAt: null, late: false, followsBuffer: false },
          { postId: "d0", kind: "discord", label: "This Week in AI #general", text: "Maintenance tonight from 22:00 UTC.", status: "failed", link: null, error: "Missing Permissions", at: new Date(Date.now() - 86_400_000).toISOString(), sendAt: null, late: false, followsBuffer: false },
        ] : []}
      />
    </AppShell>
  );
}

/** Sample places for checking the post form in development: one Discord channel the bot cannot post in. */
async function sampleTargets() {
  "use server";
  if (process.env.NODE_ENV === "production") throw new Error("Not available.");
  return {
    telegram: { label: "This Week in AI", limit: 4096 },
    discord: { label: "This Week in AI", limit: 2000, defaultId: "c1", channels: [{ id: "c1", name: "new-issues", canPost: true }, { id: "c2", name: "general", canPost: true }, { id: "c3", name: "staff-only", canPost: false }] },
  };
}
