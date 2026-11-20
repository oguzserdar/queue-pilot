/**
 * GET /v1/agent/account: where this agent's account stands (sign-up contract §4, "account status").
 *
 * The contract names this GET /v1/account. Queue Pilot keeps every agent-only call under /v1/agent/ so the agent's
 * surface is one prefix, separate from anything a person uses. A frozen account still answers: reading is allowed.
 */
import { agentReply } from "@/lib/agent-signup/envelope";
import { agentRoute, authorizeAgent, ok } from "@/lib/agent-signup/http";
import { capabilityList } from "@/lib/agent-signup/registrations";

export const GET = agentRoute(async (req, server) => {
  const a = await authorizeAgent(req, server, { write: false });
  if (!a.ok) return a.res;
  const { registration: r, account } = a.call;
  return ok(agentReply({
    registration_id: r.id,
    tool: r.tool,
    label: r.label,
    created_at: r.createdAt.toISOString(),
    capabilities: await capabilityList(r.id),
  }, account));
});
