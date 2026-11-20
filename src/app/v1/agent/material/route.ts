/**
 * The agent's own material: notes, links and transcripts it found for its person.
 *
 *   GET  /v1/agent/material   the 50 newest items this agent saved
 *   POST /v1/agent/material   {"title", "text", "link"?}: save one item (the same item twice keeps one)
 *
 * Both are scoped to the registration named by the access token; no field can name another. Saving needs the
 * save_material grant and an account that is not frozen. On claim, these are also copied into the person's material.
 * See src/lib/agent-signup/artifacts.ts for the limits.
 */
import { agentArtifactRoutes } from "@/lib/agent-signup/artifact-routes";

const routes = agentArtifactRoutes("material");
export const GET = routes.GET;
export const POST = routes.POST;
