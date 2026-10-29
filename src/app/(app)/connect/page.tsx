import { headers } from "next/headers";
import { publicOrigin } from "@/lib/origin";
import { ConnectView } from "@/components/connect-view";
import { approvedAiApps, getCurrentUser } from "@/lib/current-user";

export default async function Page() {
  const [{ user }, h, approved] = await Promise.all([getCurrentUser(), headers(), approvedAiApps()]);
  // Signed out shows the example account, where all three AIs are connected (matching the sidebar example).
  return <ConnectView connectorUrl={`${publicOrigin(h)}/api/mcp`} example={!user} approved={approved} now={Date.now()} />;
}
