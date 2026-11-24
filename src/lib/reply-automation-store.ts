/**
 * @fileoverview Saving, listing and deleting reply automations. Every call is scoped to one person: an automation is
 * only ever saved on an account that person connected, and only that person sees, changes or deletes it. Input is
 * checked here, the same for the screen and the connector.
 */
import "server-only";
import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import * as z from "zod";
import { db } from "../db";
import { replyAutomation, socialAccount } from "../db/schema";
import { MAX_KEYWORDS, MAX_REPLY_VERSIONS, type ReplyAutomation } from "./reply-automations";

/** Whether the text holds whitespace or a control character (U+0000 to U+001F, or U+007F). */
function hasSpaceOrControl(u: string): boolean {
  if (/\s/.test(u)) return true;
  for (const ch of u) {
    const code = ch.charCodeAt(0);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

/** What the screen and the connector send to save an automation; without `id` it is a new one. */
export const AutomationInput = z.object({
  id: z.string().min(1).max(100).optional(),
  accountId: z.string().min(1).max(100),
  name: z.string().trim().min(1).max(80),
  active: z.boolean().optional(),
  post: z.union([z.object({ scope: z.literal("any") }), z.object({ scope: z.literal("post"), externalId: z.string().trim().min(1).max(500) })]),
  keywords: z.array(z.string().trim().min(1).max(60)).max(MAX_KEYWORDS),
  replyMode: z.enum(["voice", "fixed"]),
  replyTexts: z.array(z.string().trim().min(1).max(500)).max(MAX_REPLY_VERSIONS),
  // One plain https URL: it reaches the drafter's instructions, so no spaces, line breaks or control characters.
  link: z.string().trim().url().max(500).refine((u) => u.startsWith("https://"), "The link must start with https://")
    .refine((u) => !hasSpaceOrControl(u), "The link must be one web address, with no spaces or line breaks.").nullable(),
}).refine((a) => a.replyMode === "voice" || a.replyTexts.length > 0, { message: "A fixed reply needs at least one version.", path: ["replyTexts"] });
export type AutomationInput = z.infer<typeof AutomationInput>;

/** An automation as the screen and the connector show it. */
export type AutomationView = ReplyAutomation & { accountId: string; name: string };

type Row = typeof replyAutomation.$inferSelect;
const view = (r: Row): AutomationView => ({
  id: r.id, accountId: r.accountId, name: r.name, active: r.active,
  post: r.postScope === "post" && r.postExternalId ? { scope: "post", externalId: r.postExternalId } : { scope: "any" },
  keywords: r.keywords, replyMode: r.replyMode === "fixed" ? "fixed" : "voice", replyTexts: r.replyTexts, link: r.link, createdAt: r.createdAt,
});

export type SaveResult = { ok: true; id: string } | { ok: false; error: "not-found" | "invalid"; message?: string };

/**
 * Saves a new automation or updates one of the person's own.
 *
 * @returns not-found when the account (or, on update, the automation) is not this person's; invalid with the reason
 */
export async function saveAutomation(userId: string, raw: unknown, now = new Date()): Promise<SaveResult> {
  const parsed = AutomationInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "invalid", message: parsed.error.issues[0]?.message };
  const a = parsed.data;
  const [account] = await db().select({ id: socialAccount.id }).from(socialAccount).where(and(eq(socialAccount.id, a.accountId), eq(socialAccount.userId, userId))).limit(1);
  if (!account) return { ok: false, error: "not-found" };
  const values = {
    accountId: a.accountId, name: a.name, postScope: a.post.scope, postExternalId: a.post.scope === "post" ? a.post.externalId : null,
    keywords: a.keywords, replyMode: a.replyMode, replyTexts: a.replyMode === "fixed" ? a.replyTexts : [], link: a.link, updatedAt: now,
    ...(a.active === undefined ? {} : { active: a.active }),
  };
  if (a.id) {
    const rows = await db().update(replyAutomation).set(values).where(and(eq(replyAutomation.id, a.id), eq(replyAutomation.userId, userId))).returning({ id: replyAutomation.id });
    return rows.length ? { ok: true, id: a.id } : { ok: false, error: "not-found" };
  }
  const id = `auto_${randomUUID()}`;
  await db().insert(replyAutomation).values({ id, userId, createdAt: now, ...values });
  return { ok: true, id };
}

/** The person's automations, oldest first. */
export async function listAutomations(userId: string): Promise<AutomationView[]> {
  return (await db().select().from(replyAutomation).where(eq(replyAutomation.userId, userId)).orderBy(asc(replyAutomation.createdAt), asc(replyAutomation.id))).map(view);
}

/** The switched-on automations of one of the person's accounts, as the replies run matches them. */
export async function activeAutomations(userId: string, accountId: string): Promise<AutomationView[]> {
  return (await db().select().from(replyAutomation).where(and(eq(replyAutomation.userId, userId), eq(replyAutomation.accountId, accountId), eq(replyAutomation.active, true)))).map(view);
}

/** Deletes one of the person's automations; false when there is no such automation of theirs. */
export async function deleteAutomation(userId: string, id: string): Promise<boolean> {
  const rows = await db().delete(replyAutomation).where(and(eq(replyAutomation.id, id), eq(replyAutomation.userId, userId))).returning({ id: replyAutomation.id });
  return rows.length === 1;
}
