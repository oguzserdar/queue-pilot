import { notFound } from "next/navigation";
import { AppShell, type ShellAccount } from "@/components/app-shell";
import type { SyncStatus } from "@/components/buffer-sync";

/** Development only: every Buffer sync state in the real app frame, for screenshots. Production answers 404. */
const STATES: Record<string, { minutesAgo: number; status?: SyncStatus }> = {
  fresh: { minutesAgo: 3 },
  syncing: { minutesAgo: 7, status: { kind: "syncing" } },
  failed: { minutesAgo: 42, status: { kind: "failed" } },
  limited: { minutesAgo: 95, status: { kind: "limited", retryAt: new Date(Date.now() + 3 * 3_600_000).toISOString() } },
};

export default async function Page({ searchParams }: { searchParams: Promise<{ state?: string }> }) {
  if (process.env.NODE_ENV === "production") notFound();
  const name = (await searchParams).state ?? "fresh";
  const state = STATES[name] ?? STATES.fresh;
  const account: ShellAccount = {
    email: "mark@weeknightdinners.example",
    channelCount: 3,
    fetchedAt: new Date(Date.now() - state.minutesAgo * 60_000).toISOString(),
    needsRefresh: false,
    name: "Mark Evans",
    image: null,
    syncPreview: state.status,
  };
  return (
    <AppShell account={account} signInOpen>
      <h1 style={{ fontSize: "1.75rem" }}>Sync state: {name}</h1>
    </AppShell>
  );
}
