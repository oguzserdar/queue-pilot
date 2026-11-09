import { headers } from "next/headers";
import { publicOrigin } from "@/lib/origin";
import type { ApprovedApp } from "@/lib/ai-access";
import { ConnectView } from "@/components/connect-view";
import { approvedAiApps, getCurrentUser } from "@/lib/current-user";
import { channels as exampleChannels } from "@/lib/example-channels";

/** Alex's example account for signed-out visitors: the channels the example week shows, and Claude already connected. */
const EXAMPLE_ACCOUNT = { email: "Alex Rivera (example)", channels: exampleChannels.map((c) => ({ name: c.name, service: c.service, disconnected: c.isDisconnected })) };
const EXAMPLE_APPROVED: ApprovedApp[] = [{ consentId: "example", name: "Claude", brand: "Claude", site: null, approvedAt: "2026-11-01T09:00:00Z", lastUsedAt: "2026-11-01T09:12:00Z", calls: 14, label: null, returnsTo: [], unused: false }];

export default async function Page() {
  const [{ user }, h, approved] = await Promise.all([getCurrentUser(), headers(), approvedAiApps()]);
  // Signed out shows the example account, where Claude is connected (matching the sidebar example).
  const account = user ? { email: user.email, channels: user.channels.map((c) => ({ name: c.name, service: c.service, disconnected: c.isDisconnected })) } : EXAMPLE_ACCOUNT;
  return <ConnectView connectorUrl={`${publicOrigin(h)}/api/mcp`} example={!user} approved={user ? approved : EXAMPLE_APPROVED} account={account} />;
}
