/** One skill's SKILL.md, for every skill this deployment serves. The main skill carries this deployment's address. */
import { servedSkills } from "@/lib/agent-skill";
import { configuredOrigin } from "@/lib/origin";

export async function GET(req: Request, { params }: { params: Promise<{ name: string }> }): Promise<Response> {
  const { name } = await params;
  const text = Object.hasOwn(servedSkills(configuredOrigin(req)), name) ? servedSkills(configuredOrigin(req))[name] : null;
  if (text === null) return new Response("Not found", { status: 404 });
  return new Response(text, { headers: { "Content-Type": "text/markdown; charset=utf-8", "Cache-Control": "public, max-age=300" } });
}
