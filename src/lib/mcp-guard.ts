/**
 * @fileoverview The one door every connector tool is registered through. Each call passes the same per-person rate
 * limits as the web app, runs inside the Buffer request budget, and has its errors scrubbed: Queue Pilot's own errors
 * keep their wording, but a database error (whose message carries SQL and the user id) is logged and replaced before
 * anything reaches the chat.
 * @module lib/mcp-guard
 *
 * @remarks
 * | Export | Purpose |
 * |--------|---------|
 * | {@link guardServer} | Gives a server the person and address its tools are guarded for; call it before any tool |
 * | {@link registerGuardedTool} | Registers a tool behind the guard; a server without one refuses the registration |
 * | {@link TOOL_LIMIT} | Tools that spend a shared per-person allowance, and which one |
 */
import type { CallToolResult, McpServer, ServerContext, StandardSchemaWithJSON, ToolAnnotations } from "@modelcontextprotocol/server";
import { limit, type Action } from "./rate-limit";
import { toolErrorMessage } from "./tool-error";
import { AiCapError } from "./judge-model";
import { TooManyRulesError } from "./rules-store";
import { BufferApiError, BufferRateLimitedError } from "./buffer/client";
import { BufferAllowanceLowError, BufferAllowanceUnknownError, withBudget } from "./buffer/budget";

/** Tools that spend a shared per-person allowance, and which one. */
export const TOOL_LIMIT: Record<string, Action> = {
  write_my_week: "ai",
  move_back_to_draft: "bufferWrite",
  check_draft: "ai",
  refresh_buffer: "bufferWrite",
  save_drafts: "bufferWrite",
  update_draft: "bufferWrite",
  delete_draft: "bufferWrite",
  add_source: "outbound",
  list_new_material: "outbound",
  read_material: "outbound",
  get_transcript: "outbound",
  search_context: "outbound",
  add_web_page: "outbound",
  report_source_version: "outbound",
  save_snippet: "bufferWrite",
  delete_snippet: "bufferWrite",
  save_channel_less_draft: "bufferWrite",
  promote_to_draft_posts: "bufferWrite",
  update_content_item: "bufferWrite",
  delete_content_item: "bufferWrite",
  link_post_to_content_item: "bufferWrite",
  rename_tag: "bufferWrite",
  delete_tag: "bufferWrite",
  unlink_post_from_content_item: "bufferWrite",
  tag_draft: "bufferWrite",
  create_tag: "bufferWrite",
  add_draft_note: "bufferWrite",
  update_draft_note: "bufferWrite",
  delete_draft_note: "bufferWrite",
  save_idea: "bufferWrite",
};


/** Who a server's tools act for, and the address the person signs in at again when Buffer's sign-in is lost. */
export type ToolGuard = { userId: string; websiteUrl: string };

/** A tool's definition, as the MCP server takes it. */
export type ToolDefinition<I, O> = { title?: string; description?: string; inputSchema?: I; outputSchema?: O; annotations?: ToolAnnotations; _meta?: Record<string, unknown> };

const guards = new WeakMap<McpServer, ToolGuard>();

/** Tools whose failures are the person's own controls: an AI cap or a full playbook says why, anything else asks for a fresh read. */
const CONTROLS = ["get_transcript", "list_sources_to_check", "report_source_version", "add_rule", "remove_rule", "read_rule", "check_draft", "fill_post_template", "list_rule_suggestions", "keep_suggestion", "dismiss_suggestion", "list_sources", "remove_source", "remove_material", "get_setup_status", "write_my_week", "list_my_drafts", "refresh_buffer", "list_channels", "get_ai_usage", "share_for_review", "list_review_comments", "turn_off_review", "propose_rule_fixes", "propose_review_changes", "propose_note_changes", "get_effective_rules", "set_rule_override", "set_rule_inheritance", "list_ai_models", "set_ai_model"];
/** Tools that save something private to the person. */
const PRIVATE_WRITES = ["save_my_voice_note", "add_voice_example", "add_material"];

const refusal = (text: string): CallToolResult => ({ content: [{ type: "text", text }], isError: true });

/**
 * Gives a server the person and address its tools are guarded for.
 *
 * @param server - The connector's server, before any tool is registered on it
 * @param guard - The signed-in person and the deployment's address
 */
export function guardServer(server: McpServer, guard: ToolGuard): void {
  guards.set(server, guard);
}

/** What a failed tool says in the chat: a known refusal in its own words, else a plain line that leaks nothing. */
function failureAnswer(name: string, e: unknown, websiteUrl: string): CallToolResult {
  if (e instanceof BufferAllowanceLowError || e instanceof BufferAllowanceUnknownError || e instanceof BufferRateLimitedError) return refusal(e.message);
  // A lost Buffer sign-in is named in every tool, so the AI sends the person to reconnect instead of retrying.
  if ((e instanceof BufferApiError && e.status === 401) || (e instanceof Error && /access token/i.test(e.message))) return refusal(`Queue Pilot can no longer read this person's Buffer: the Buffer sign-in expired or was revoked. Ask them to open ${websiteUrl} and sign in with Buffer again, then retry. Do not retry before that.`);
  if (name === "remove_voice_example") return refusal("Could not remove that example just now. Try again in a minute.");
  if (CONTROLS.includes(name) && (e instanceof AiCapError || e instanceof TooManyRulesError)) return refusal(e.message);
  if (CONTROLS.includes(name)) return refusal("Could not complete that action just now. Read the current state before retrying.");
  return refusal(PRIVATE_WRITES.includes(name) ? "Could not save that just now. Try again in a minute." : toolErrorMessage(e));
}

/** Runs one tool call behind the limits, inside the Buffer budget, with its errors scrubbed. */
async function runGuarded(name: string, guard: ToolGuard, run: () => Promise<CallToolResult> | CallToolResult): Promise<CallToolResult> {
  try {
    // The same per-person limits as the web app: tools that fetch outside addresses or write to Buffer share them,
    // so connecting several AI apps does not multiply them.
    const kind = TOOL_LIMIT[name];
    if (kind) {
      const l = await limit(kind, guard.userId);
      if (!l.ok) return refusal(`Too many requests just now. Try again in ${Math.max(1, Math.ceil(l.resetSeconds / 60))} min.`);
    }
    // Counts this call's Buffer requests and stops it before Buffer when the allowance is down to the reserve.
    return (await withBudget(name, guard.userId, async () => run())).result;
  } catch (e) {
    console.error(JSON.stringify({ event: "qp-tool-failed", tool: name, message: e instanceof Error ? e.message : String(e) }));
    return failureAnswer(name, e, guard.websiteUrl);
  }
}

/**
 * Registers a connector tool behind the guard. The handler keeps the argument types its input schema gives. A tool
 * without an input schema is called with the request context alone, so its handler takes no arguments.
 *
 * @param server - A server already given its guard with {@link guardServer}
 * @param name - The tool's name
 * @param definition - Title, description, schemas and hints
 * @param handler - The tool itself
 * @returns The registered tool
 * @throws Error when the server has no guard, so no tool can be registered without the limits and error scrubbing
 */
export function registerGuardedTool<In, A, O extends StandardSchemaWithJSON>(server: McpServer, name: string, definition: ToolDefinition<StandardSchemaWithJSON<In, A>, O>, handler: (args: A, ctx: ServerContext) => Promise<CallToolResult> | CallToolResult) {
  const guard = guards.get(server);
  if (!guard) throw new Error(`The tool ${name} was registered on a server without a guard. Call guardServer first.`);
  return server.registerTool<O, StandardSchemaWithJSON<In, A>>(name, definition, (args: A, ctx: ServerContext) => runGuarded(name, guard, () => handler(args, ctx)));
}
