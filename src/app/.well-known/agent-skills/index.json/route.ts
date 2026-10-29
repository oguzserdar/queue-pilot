/** Agent Skills discovery index for this deployment (lists the Queue Pilot skill and its digest). */
import { skillIndex } from "@/lib/agent-skill";
import { configuredOrigin } from "@/lib/origin";

export function GET(req: Request): Response {
  return Response.json(skillIndex(configuredOrigin(req)), { headers: { "Cache-Control": "public, max-age=300" } });
}
