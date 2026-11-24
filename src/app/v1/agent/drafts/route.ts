/**
 * The agent's private drafts: text it wrote for its person to read later.
 *
 *   GET  /v1/agent/drafts   the 50 newest drafts this agent saved
 *   POST /v1/agent/drafts   {"title", "text"}: save one draft (the same draft twice keeps one)
 *
 * Drafts never leave this table: nothing here writes to Buffer, schedules, publishes or shares them. Both calls are
 * scoped to the registration named by the access token. Saving needs the save_drafts grant and an account that is
 * not frozen. See src/lib/agent-signup/artifacts.ts for the limits.
 */
import { agentArtifactRoutes } from "@/lib/agent-signup/artifact-routes";

const routes = agentArtifactRoutes("draft");
export const GET = routes.GET;
export const POST = routes.POST;
