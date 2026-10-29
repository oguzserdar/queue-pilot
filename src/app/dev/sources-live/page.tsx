import { notFound } from "next/navigation";
import { AppShell, type ShellAccount } from "@/components/app-shell";
import { SourcesView } from "@/components/sources-view";

/** Development only: the signed-in Sources screen with example data, for screenshots. Production answers 404. */
export default async function Page({ searchParams }: { searchParams: Promise<{ connected?: string }> }) {
  if (process.env.NODE_ENV === "production") notFound();
  const connected = (await searchParams).connected === "1";
  const account: ShellAccount = { email: "mark@weeknightdinners.example", channelCount: 3, fetchedAt: new Date(Date.now() - 3 * 60_000).toISOString(), needsRefresh: false, name: "Mark Evans", image: null };
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
          { id: "s1", title: "Weeknight Dinners", url: "https://weeknightdinners.example/feed" },
          { id: "s2", title: "Weeknight Dinners on YouTube", url: "https://www.youtube.com/feeds/videos.xml?channel_id=UCweeknightdinners" },
        ]}
        copies={connected ? [{ kind: "telegram", label: "Weeknight Dinners news" }, { kind: "discord", label: "Weeknight Dinners #new-issues" }] : []}
        discordResult={null}
      />
    </AppShell>
  );
}
