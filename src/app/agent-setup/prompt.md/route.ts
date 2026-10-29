/** Setup instructions a coding agent fetches to connect itself to this deployment. */
import { setupPrompt } from "@/lib/agent-setup";
import { configuredOrigin } from "@/lib/origin";

export function GET(req: Request): Response {
  return new Response(setupPrompt(configuredOrigin(req)), {
    headers: { "Content-Type": "text/markdown; charset=utf-8", "Cache-Control": "public, max-age=300" },
  });
}
