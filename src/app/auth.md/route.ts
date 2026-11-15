/**
 * GET /auth.md: the instructions an AI agent reads to sign itself up (src/lib/agent-signup/auth-md.ts). The folder is
 * named auth.md, so Next serves it at exactly /auth.md with no rewrite. The text is built from this server's own
 * address, so a self-hosted copy describes itself.
 */
import { agentServer } from "@/lib/agent-signup/server";
import { authMd } from "@/lib/agent-signup/auth-md";

export async function GET(req: Request): Promise<Response> {
  const server = await agentServer().catch(() => null);
  const baseURL = server?.baseURL ?? new URL(req.url).origin;
  return new Response(authMd(baseURL), { headers: { "Content-Type": "text/markdown; charset=utf-8", "Cache-Control": "public, max-age=300" } });
}
