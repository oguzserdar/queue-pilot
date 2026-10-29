/** The Queue Pilot agent skill, with this deployment's connector address in it. */
import { skillMarkdown } from "@/lib/agent-skill";
import { configuredOrigin } from "@/lib/origin";

export function GET(req: Request): Response {
  return new Response(skillMarkdown(configuredOrigin(req)), {
    headers: { "Content-Type": "text/markdown; charset=utf-8", "Cache-Control": "public, max-age=300" },
  });
}
