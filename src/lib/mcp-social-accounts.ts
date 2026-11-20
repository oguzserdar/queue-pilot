/**
 * @fileoverview The person's own social-account tools on the connector: see which Mastodon and Bluesky accounts are
 * connected, and turn automatic replies on or off for one. Credentials never leave the server: the list reads no
 * credential column, and connecting an account happens in Settings, never through an AI app.
 *
 * Each tool declares an output schema and returns structured content (MCP 2026-07-28), with the same facts as text for
 * clients that read only text.
 */
import type { McpServer } from "@modelcontextprotocol/server";
import { SOCIAL_NETWORKS } from "./social-networks";
import * as z from "zod";
import { listSocialAccounts, setReplies } from "./social-accounts";
import { approveMode } from "./agent-permission";
import { registerGuardedTool } from "./mcp-guard";

const text = (t: string, isError = false) => ({ content: [{ type: "text" as const, text: t }], ...(isError ? { isError: true } : {}) });

const Account = z.object({
  id: z.string(),
  network: z.enum(SOCIAL_NETWORKS),
  handle: z.string(),
  server: z.string(),
  replies_on: z.boolean(),
  needs_reconnect: z.boolean().describe("The network refused Queue Pilot's sign-in; the person connects it again in Settings"),
});

/**
 * Registers list_social_accounts and set_replies for one person's connector session.
 *
 * @param server - The session's MCP server
 * @param userId - The signed-in person; every call is scoped to their accounts only
 */
export function registerSocialAccountTools(server: McpServer, userId: string): void {
  registerGuardedTool(server, "list_social_accounts", {
    title: "List connected social accounts",
    description: "Lists the Mastodon and Bluesky accounts this person connected in Queue Pilot: id, network, handle, whether automatic replies are on, and whether the account needs connecting again. Use an id from here with set_replies.",
    inputSchema: z.object({}),
    outputSchema: z.object({ accounts: z.array(Account) }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async () => {
    const accounts = (await listSocialAccounts(userId)).map((a) => ({ id: a.id, network: a.network, handle: a.handle, server: a.server, replies_on: a.repliesOn, needs_reconnect: a.broken }));
    const summary = accounts.length ? JSON.stringify(accounts) : "No Mastodon or Bluesky account is connected. The person connects one in Queue Pilot's Settings.";
    return { ...text(summary), structuredContent: { accounts } };
  });

  registerGuardedTool(server, "set_replies", {
    title: "Turn automatic replies on or off",
    description: "Turns automatic replies on or off for one connected account. Turning them on works only when the person let their AI act without asking in Settings; turning them off always works. When on, Queue Pilot answers new mentions in the person's voice under their rules, starting from now (never older mentions). A reply the rules or the judge stop is not sent: it goes to the inbox with the reason.",
    inputSchema: z.object({ account_id: z.string().min(1).max(100).describe("An id from list_social_accounts"), on: z.boolean() }),
    outputSchema: z.object({ account_id: z.string(), replies_on: z.boolean() }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ account_id, on }) => {
    // Turning replies on starts public answers in the person's name, so an AI app may do it only when the person let
    // their AI act without asking (the same setting approve_drafts follows). Turning them off is always allowed.
    if (on && (await approveMode(userId)) !== "direct") return text("Only the person can turn replies on, in Queue Pilot's Settings, Channels. (Their AI setting asks first; if they let their AI act without asking, this tool can do it.)", true);
    const r = await setReplies(userId, account_id, on);
    if (r === "not-found") return text("No connected account with that id. Call list_social_accounts for the ids.", true);
    if (r === "taken") return text("Someone else in Queue Pilot already answers this account's mentions, so replies stay off here.", true);
    return { ...text(on ? "Replies are on for that account, from now." : "Replies are off for that account."), structuredContent: { account_id, replies_on: on } };
  });
}
