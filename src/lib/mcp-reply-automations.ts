/**
 * @fileoverview Reply automations on the connector: list, save, delete, and try one on a sample comment. An AI app can
 * set up a whole comment-to-reply automation in one call. Everything is scoped to the signed-in person's own accounts.
 *
 * Saving an automation that is on starts public replies in the person's name with words an AI app chose, so it needs
 * the same "act without asking" setting as set_replies; saving one switched off, and deleting, always work. Trying sends
 * nothing and calls no AI. Each tool declares an output schema and returns structured content as well as text.
 */
import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod";
import { approveMode } from "./agent-permission";
import { activeAutomations, deleteAutomation, listAutomations, saveAutomation, type AutomationView } from "./reply-automation-store";
import { matchAutomation, MAX_KEYWORDS, MAX_REPLY_VERSIONS, pickVersion } from "./reply-automations";
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { replyAutomation, socialAccount } from "../db/schema";
import { registerGuardedTool } from "./mcp-guard";

/**
 * True when removing or switching off this automation would make its account answer every mention in the person's
 * voice: it is the account's last active automation and replies are on. An AI app may then do it only when the person
 * let their AI act without asking.
 */
async function widensReplies(userId: string, automationId: string): Promise<boolean> {
  const [a] = await db().select({ accountId: replyAutomation.accountId, active: replyAutomation.active }).from(replyAutomation).where(and(eq(replyAutomation.id, automationId), eq(replyAutomation.userId, userId))).limit(1);
  if (!a?.active) return false;
  const [acc] = await db().select({ on: socialAccount.repliesOn }).from(socialAccount).where(and(eq(socialAccount.id, a.accountId), eq(socialAccount.userId, userId))).limit(1);
  if (!acc?.on) return false;
  return (await activeAutomations(userId, a.accountId)).length === 1;
}
const WIDENS = "This is the account's last automation and its replies are on, so without it every new mention would be answered in the person's voice. Only the person can do that, in Settings (their AI setting asks first).";

/** The account's id on its network (a Bluesky DID), so an at:// post is matched only when it is the account's own. */
const ownerOf = async (userId: string, accountId: string) =>
  (await db().select({ id: socialAccount.accountId }).from(socialAccount).where(and(eq(socialAccount.id, accountId), eq(socialAccount.userId, userId))).limit(1))[0]?.id ?? null;

const text = (t: string, isError = false) => ({ content: [{ type: "text" as const, text: t }], ...(isError ? { isError: true } : {}) });

const Post = z.union([
  z.object({ scope: z.literal("any") }).describe("Comments on any post"),
  z.object({ scope: z.literal("post"), external_id: z.string().min(1).max(500).describe("The post's id on the network") }).describe("Comments on one post"),
]);

const Automation = z.object({
  id: z.string(), account_id: z.string(), name: z.string(), active: z.boolean(), post: Post,
  keywords: z.array(z.string()), reply_mode: z.enum(["voice", "fixed"]), reply_texts: z.array(z.string()), link: z.string().nullable(),
});

const out = (a: AutomationView): z.infer<typeof Automation> => ({
  id: a.id, account_id: a.accountId, name: a.name, active: a.active,
  post: a.post.scope === "post" ? { scope: "post", external_id: a.post.externalId } : { scope: "any" },
  keywords: a.keywords, reply_mode: a.replyMode, reply_texts: a.replyTexts, link: a.link,
});

/**
 * Registers list_reply_automations, save_reply_automation, delete_reply_automation and try_reply_automation.
 *
 * @param server - The session's MCP server
 * @param userId - The signed-in person; every call is scoped to their accounts and automations
 */
export function registerReplyAutomationTools(server: McpServer, userId: string): void {
  registerGuardedTool(server, "list_reply_automations", {
    title: "List reply automations",
    description: "Lists this person's reply automations: on which connected account, which posts, which keywords, and what the reply says. An account with no automation answers every new mention in the person's voice (when replies are on); with automations, only mentions one matches are answered.",
    inputSchema: z.object({}),
    outputSchema: z.object({ automations: z.array(Automation) }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async () => {
    const automations = (await listAutomations(userId)).map(out);
    return { ...text(automations.length ? JSON.stringify(automations) : "No reply automations yet."), structuredContent: { automations } };
  });

  registerGuardedTool(server, "save_reply_automation", {
    title: "Save a reply automation",
    description: `Creates a reply automation, or updates one when id is given. It answers comments on one connected account (an id from list_social_accounts) when they contain a keyword as a whole word (no keywords: any comment). reply_mode "fixed" sends one of up to ${MAX_REPLY_VERSIONS} reply_texts; "voice" has the person's AI write it in their voice. A link, when given, ends every reply. Every reply still passes the person's rules and judge. Saving one that is on works only when the person let their AI act without asking; saving it with active false always works.`,
    inputSchema: z.object({
      id: z.string().min(1).max(100).optional().describe("An id from list_reply_automations, to update it"),
      account_id: z.string().min(1).max(100),
      name: z.string().min(1).max(80),
      active: z.boolean().optional().describe("Default true"),
      post: Post,
      keywords: z.array(z.string().min(1).max(60)).max(MAX_KEYWORDS),
      reply_mode: z.enum(["voice", "fixed"]),
      reply_texts: z.array(z.string().min(1).max(500)).max(MAX_REPLY_VERSIONS).default([]),
      link: z.string().max(500).nullable().default(null).describe("An https link every reply ends with"),
    }),
    outputSchema: z.object({ id: z.string(), active: z.boolean() }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (a) => {
    const active = a.active ?? true;
    if (!active && a.id && (await widensReplies(userId, a.id)) && (await approveMode(userId)) !== "direct") return text(WIDENS, true);
    if (active && (await approveMode(userId)) !== "direct") {
      return text("Only the person can switch on an automation, in Queue Pilot's Settings. (Their AI setting asks first.) You can save it with active false for them to review.", true);
    }
    const r = await saveAutomation(userId, {
      id: a.id, accountId: a.account_id, name: a.name, active,
      post: a.post.scope === "post" ? { scope: "post", externalId: a.post.external_id } : { scope: "any" },
      keywords: a.keywords, replyMode: a.reply_mode, replyTexts: a.reply_texts, link: a.link,
    });
    if (!r.ok) return text(r.error === "not-found" ? "No connected account (or automation) with that id. Call list_social_accounts and list_reply_automations for the ids." : `Not saved: ${r.message ?? "the automation is not valid"}.`, true);
    return { ...text(active ? "Saved and on." : "Saved, switched off."), structuredContent: { id: r.id, active } };
  });

  registerGuardedTool(server, "delete_reply_automation", {
    title: "Delete a reply automation",
    description: "Deletes one of this person's reply automations. Replies it already sent stay in the inbox; a reply it was still writing is not sent. Deleting an account's last automation while its replies are on needs the person's \"act without asking\" setting, because the account would then answer every mention.",
    inputSchema: z.object({ id: z.string().min(1).max(100) }),
    outputSchema: z.object({ id: z.string(), deleted: z.boolean() }),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  }, async ({ id }) => {
    if ((await widensReplies(userId, id)) && (await approveMode(userId)) !== "direct") return text(WIDENS, true);
    if (!(await deleteAutomation(userId, id))) return text("No reply automation with that id. Call list_reply_automations for the ids.", true);
    return { ...text("Deleted."), structuredContent: { id, deleted: true } };
  });

  registerGuardedTool(server, "try_reply_automation", {
    title: "Try a comment against the automations",
    description: "Shows what would happen to a sample comment on one connected account: whether it is answered, by which automation, and the reply when it is a fixed one. Sends nothing and calls no AI; a voice reply is written only when a real comment arrives, and it still passes the rules and judge.",
    inputSchema: z.object({ account_id: z.string().min(1).max(100), comment: z.string().min(1).max(2000), post_external_id: z.string().max(500).optional() }),
    outputSchema: z.object({ answered: z.boolean(), automation_id: z.string().nullable(), automation_name: z.string().nullable(), reply: z.string().nullable(), note: z.string() }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ account_id, comment, post_external_id }) => {
    const autos = await activeAutomations(userId, account_id);
    const owner = await ownerOf(userId, account_id);
    if (!autos.length) {
      const sc = { answered: true, automation_id: null, automation_name: null, reply: null, note: "No automation is on for this account, so every new mention is answered in the person's voice (when replies are on)." };
      return { ...text(sc.note), structuredContent: sc };
    }
    const hit = matchAutomation(autos, { text: comment, postExternalId: post_external_id ?? null }, { owner: owner ?? undefined });
    if (!hit) {
      const sc = { answered: false, automation_id: null, automation_name: null, reply: null, note: "No automation matches, so this comment is kept in the inbox and not answered." };
      return { ...text(sc.note), structuredContent: sc };
    }
    let reply: string | null = null;
    if (hit.replyMode === "fixed") {
      reply = pickVersion(hit.replyTexts, comment);
      if (hit.link && !reply.includes(hit.link)) reply = `${reply} ${hit.link}`;
    }
    const sc = { answered: true, automation_id: hit.id, automation_name: hit.name, reply, note: reply ? "One of the fixed versions; the real reply also starts with the person's @handle where the network needs it." : "Written in the person's voice when a real comment arrives." };
    return { ...text(`${hit.name}: ${reply ?? sc.note}`), structuredContent: sc };
  });
}
