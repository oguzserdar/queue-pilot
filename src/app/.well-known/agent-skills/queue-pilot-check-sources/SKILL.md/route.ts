import { CHECK_SOURCES_SKILL } from "@/lib/check-sources-skill";
export function GET() {
  return new Response(CHECK_SOURCES_SKILL, { headers: { "Content-Type": "text/markdown; charset=utf-8", "Cache-Control": "public, max-age=300" } });
}
