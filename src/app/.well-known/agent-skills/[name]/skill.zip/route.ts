/** A plugin skill that ships reference files, as one zip (the discovery index lists it with type "archive"). */
import { skillArchive } from "@/lib/agent-skill";

export async function GET(_req: Request, { params }: { params: Promise<{ name: string }> }): Promise<Response> {
  const archive = skillArchive((await params).name);
  if (!archive) return new Response("Not found", { status: 404 });
  return new Response(archive.slice().buffer, { headers: { "Content-Type": "application/zip", "Cache-Control": "public, max-age=300" } });
}
