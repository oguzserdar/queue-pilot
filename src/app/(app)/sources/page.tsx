import { headers } from "next/headers";
import { publicOrigin } from "@/lib/origin";
import { SourcesView } from "@/components/sources-view";
import { getCurrentUser, signedInUserId } from "@/lib/current-user";
import { postgresSourceStore } from "@/lib/sources-store";
import { postgresEchoStore } from "@/lib/echo-store";

export default async function Page({ searchParams }: { searchParams: Promise<{ discord?: string }> }) {
  const { user } = await getCurrentUser();
  const origin = publicOrigin(await headers());
  if (!user) return <SourcesView mode="example" connectorUrl={`${origin}/api/mcp`} />;
  const userId = await signedInUserId();
  const [sources, destinations] = userId ? await Promise.all([postgresSourceStore().list(userId), postgresEchoStore().destinations(userId)]) : [[], []];
  const { discord } = await searchParams;
  return <SourcesView mode="live" channels={user.channels} connectorUrl={`${origin}/api/mcp`} sources={sources.map((s) => ({ id: s.id, title: s.title, url: s.url }))} copies={destinations.map((d) => ({ kind: d.kind, label: d.label }))} discordResult={discord ?? null} />;
}
