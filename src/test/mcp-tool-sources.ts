/**
 * @fileoverview The connector's tool modules as text, for tests that check what the connector registers. Tools are
 * registered in the modules beside the MCP route (src/app/api/mcp) and in src/lib's mcp-* modules, each through
 * registerGuardedTool.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "../..");
const ROUTE_DIR = join(ROOT, "src/app/api/mcp");

/**
 * The source of every module beside the MCP route (not its tests), then the named src/lib modules.
 *
 * @param libFiles - File names in src/lib to add, such as "mcp-controls.ts"
 * @returns The files' text, joined
 */
export function mcpToolSource(...libFiles: string[]): string {
  const route = readdirSync(ROUTE_DIR).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts")).sort().map((f) => join(ROUTE_DIR, f));
  return [...route, ...libFiles.map((f) => join(ROOT, "src/lib", f))].map((f) => readFileSync(f, "utf8")).join("\n");
}

/**
 * The names of the tools a source registers by a literal name.
 *
 * @param source - Module text from {@link mcpToolSource}
 * @returns Tool names in source order
 */
export function registeredToolNames(source: string): string[] {
  return [...source.matchAll(/registerGuardedTool\(server,\s*"([a-z_]+)"/g)].map((m) => m[1]);
}
