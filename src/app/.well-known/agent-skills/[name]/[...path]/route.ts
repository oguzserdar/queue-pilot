/** One reference file a plugin skill ships beside its SKILL.md, for installs that fetch files one by one. */
import { skillFile } from "@/lib/agent-skill";

export async function GET(_req: Request, { params }: { params: Promise<{ name: string; path: string[] }> }): Promise<Response> {
  const { name, path } = await params;
  const text = skillFile(name, path.join("/"));
  if (text === null) return new Response("Not found", { status: 404 });
  return new Response(text, { headers: { "Content-Type": "text/markdown; charset=utf-8", "Cache-Control": "public, max-age=300" } });
}
