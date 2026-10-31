import { PlaybookView, type ShownRule } from "@/components/playbook-view";
import { getCurrentUser, signedInUserId } from "@/lib/current-user";
import { postgresRulesStore } from "@/lib/rules-store";

export default async function Page({ searchParams }: { searchParams: Promise<{ first?: string }> }) {
  const userId = await signedInUserId();
  if (!userId) return <PlaybookView mode="example" firstVisit={(await searchParams).first === "1"} />;
  const stored = await postgresRulesStore().list(userId).catch((e) => {
    console.error(JSON.stringify({ event: "qp-rules-read-failed", message: e instanceof Error ? e.message : String(e) }));
    return [];
  });
  const rules: ShownRule[] = stored.map(({ fixes, ...r }) => ({ ...r, origin: fixes > 0 ? `From ${fixes} of your fixes` : "Added by you" }) as ShownRule);
  // Rules from the person's edits are proposed by a model that reads them by meaning (the finder on this page), never
  // by matching words, so the page offers nothing on its own.
  // The networks the person posts to, from the saved copy of their Buffer, so a shared rule can be switched off per network.
  const { user } = await getCurrentUser().catch(() => ({ user: null }));
  const networks = [...new Set((user?.channels ?? []).map((c) => c.service))];
  return <PlaybookView mode="live" initial={rules} networks={networks} />;
}
