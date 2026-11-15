/**
 * @fileoverview The admin tools a connected AI app sees when its person is this deployment's admin. They are generated
 * from the operation list (src/lib/admin-operations.ts), one tool per operation that an AI app may run, and every call
 * goes through the same door as /admin: the role is read again, the app's admin grant is required, and the call is
 * recorded. Operations only the admin may run on the page (giving an app admin access) get no tool.
 */
import type { McpServer } from "@modelcontextprotocol/server";
import { adminOperationList, invokeAdminOperation, NEXT_STEP, type AdminPrincipal } from "./admin-operations";
import { registerGuardedTool } from "./mcp-guard";

const text = (t: string, isError = false) => ({ content: [{ type: "text" as const, text: t }], ...(isError ? { isError: true } : {}) });

/** "admin.settings.list" becomes "admin_settings_list". */
export const adminToolName = (operation: string) => operation.replace(/\./g, "_");

/** The codes every admin tool can answer with, each with what to do next, appended to the tool's description. */
const ERRORS = Object.entries(NEXT_STEP).map(([code, step]) => `${code}: ${step}`).join(" ");

/**
 * Registers the admin tools on one connector session. Call only when the person is the admin now; each call still
 * re-checks the role and the app's grant in the door.
 *
 * @param server - The session's MCP server
 * @param principal - The admin and the AI app (client id) making the calls
 * @returns The names of the tools registered
 */
export function registerAdminTools(server: McpServer, principal: Extract<AdminPrincipal, { via: "mcp" }>): string[] {
  const names: string[] = [];
  for (const [operation, def] of adminOperationList()) {
    if (def.pageOnly) continue;
    const name = adminToolName(operation);
    registerGuardedTool(server, name, {
      title: `Admin: ${def.title}`,
      description: `${def.description} Admin only: works when the admin gave this app admin access in Settings. On an error the answer starts with its code. ${ERRORS}`,
      inputSchema: def.input,
      annotations: {
        readOnlyHint: def.kind === "query",
        destructiveHint: def.destructive,
        idempotentHint: def.kind === "query",
        openWorldHint: def.openWorld ?? false,
      },
    }, async (input: unknown) => {
      const r = await invokeAdminOperation(principal, operation, input);
      if (r.ok) return text(JSON.stringify(r.value, null, 2));
      return text(`${r.code}: ${r.field ? `${r.field}: ` : ""}${r.message} Next step: ${r.nextStep}`, true);
    });
    names.push(name);
  }
  return names;
}
