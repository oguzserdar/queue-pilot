import { headers } from "next/headers";
import { publicOrigin } from "@/lib/origin";
import { SourcesView } from "@/components/sources-view";
import { getCurrentUser, signedInUserId } from "@/lib/current-user";
import { postgresSourceStore } from "@/lib/sources-store";

export default async function Page() {
  const { user } = await getCurrentUser();
  const origin = publicOrigin(await headers());
  if (!user) return <SourcesView mode="example" connectorUrl={`${origin}/api/mcp`} />;
  const userId = await signedInUserId();
  const sources = userId ? await postgresSourceStore().list(userId) : [];
  return <SourcesView mode="live" channels={user.channels} connectorUrl={`${origin}/api/mcp`} sources={sources.map((s) => ({ id: s.id, title: s.title, url: s.url }))} copies={[]} discordResult={null} posts={[]} />;
}
