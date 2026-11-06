import { channels as exampleChannels } from "@/lib/example-channels";
import { readInheritance } from "@/lib/rule-routing-store";
import { PlaybookView, type ShownRule } from "@/components/playbook-view";
import { getCurrentUser, signedInUserId } from "@/lib/current-user";
import { postgresRulesStore } from "@/lib/rules-store";
import { ruleOrigin } from "@/lib/rule-origin";

export default async function Page({ searchParams }: { searchParams: Promise<{ first?: string }> }) {
  const userId = await signedInUserId();
  // The example shows the same account view a signed-in person sees, for Alex's four accounts.
  if (!userId) return <PlaybookView mode="example" firstVisit={(await searchParams).first === "1"} accounts={exampleChannels.filter((c) => !c.isDisconnected).map((c) => ({ id: c.id, name: c.handle, service: c.service }))} />;
  const loaded = await Promise.all([postgresRulesStore().list(userId), readInheritance(userId)]).catch((e) => {
    console.error(JSON.stringify({ event: "qp-rules-read-failed", message: e instanceof Error ? e.message : String(e) }));
    return null;
  });
  if (!loaded) return <section><h1>Playbook unavailable</h1><p role="alert">Could not read the rules and their account settings. Refresh to try again.</p></section>;
  const [stored, inheritance] = loaded;
  // Where each rule came from, from its record; an older rule with no record says nothing rather than guess.
  const rules: ShownRule[] = stored.map(({ fixes, ...r }) => ({ ...r, origin: ruleOrigin(r) ?? (fixes > 0 ? `From ${fixes} of your fixes` : undefined) }) as ShownRule);
  // Rules from the person's edits are proposed by a model that reads them by meaning (the finder on this page), never
  // by matching words, so the page offers nothing on its own.
  // The networks the person posts to, from the saved copy of their Buffer, so a shared rule can be switched off per network.
  const { user } = await getCurrentUser().catch(() => ({ user: null }));
  const networks = [...new Set((user?.channels ?? []).map((c) => c.service))];
  return <PlaybookView mode="live" initial={rules} networks={networks} accounts={user?.channels ?? []} inheritance={inheritance} />;
}
