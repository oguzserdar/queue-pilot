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
      />
    </AppShell>
  );
}
