/** Account-scoped controls shared by every connected AI. No browser-session actions or privileged account controls. */
import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod";
import { postgresRulesStore } from "./rules-store";
import { NETWORKS, parseNewRule } from "./rules";
import { judgeDrafts, rulesFor } from "./judge";
import { judgeModelFor, allowanceFor } from "./judge-model";
import { structureRule } from "./structure-rule";
import { postgresMaterialStore } from "./material-store";
import { postgresSourceStore } from "./sources-store";
import { postgresVoiceStore } from "./voice-store";
import { postgresWrittenStore } from "./written-store";
import { postgresAiKeyStore } from "./ai-key-store";
import { approvedApps } from "./ai-access";
import { setupReadiness } from "./setup-readiness";
import { writeSlotsForUser, type WriteBuffer } from "./write-slots-for-user";
import { nextWeekRange } from "./week-from-buffer";
import { postsBetween } from "./posts-between";
import { limitFor } from "./char-limits";
import { applySuggestion, ruleSuggestions } from "./rule-suggestions";
import { limit } from "./rate-limit";

const result = (value: unknown, isError = false) => ({ content: [{ type: "text" as const, text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }], ...(isError ? { isError: true } : {}) });
const read = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
const write = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
const remove = { ...write, destructiveHint: true, idempotentHint: true };
const network = z.string().refine(n => Object.hasOwn(NETWORKS, n), "Pick a supported network.");
const idSchema = z.object({ id: z.string().min(1).max(200) });
const suggestionSchema = z.object({ token: z.string().min(1).max(60_000).describe("Exact token returned by list_rule_suggestions; do not edit it.") });
type BufferReader = (force?: boolean) => Promise<WriteBuffer & { fetchedAt: Date }>;

export function registerControls(server: McpServer, userId: string, buffer: BufferReader) {
  server.registerTool("add_rule", {
    title: "Add a playbook rule",
    description: "Add a rule the user requests. Use guidance for their own words, banned for a phrase, replace for a word swap, or ends_with for a required ending. block refuses failing drafts; warn saves and flags them. Return the rule ID. Read get_playbook first to avoid duplicates. Every rule is judged by meaning, including guidance.",
    inputSchema: z.object({ kind: z.enum(["guidance", "banned", "replace", "ends_with"]), text: z.string().max(200).optional(), phrase: z.string().max(120).optional(), from: z.string().max(120).optional(), to: z.string().max(120).optional(), where: z.enum(["start", "end"]).optional(), channels: z.union([z.literal("all"), z.array(network).min(1).max(7)]), level: z.enum(["block", "warn"]) }), annotations: write,
  }, async input => {
    let rule = parseNewRule(input);
    if (typeof rule === "string") return result(rule, true);
    // Match the app's optional typed reading. Failure keeps the user's words as a meaning-checked guidance rule.
    if (rule.kind === "guidance") {
      const l = await limit("ai", userId);
      const jm = l.ok ? await judgeModelFor(userId).catch(() => null) : null;
      if (jm) { try { rule = await structureRule(jm.judges.explainer, rule); } finally { await jm.settle(); } }
    }
    const id = await postgresRulesStore().add(userId, rule);
    return result({ id, ...rule });
  });
  server.registerTool("remove_rule", { title: "Remove a playbook rule", description: "Remove one rule only when the user asks. Use its ID from get_playbook. This changes future checks; it does not change existing drafts.", inputSchema: idSchema, annotations: remove }, async ({ id }) => {
    const store = postgresRulesStore();
    if (!(await store.list(userId)).some(r => r.id === id)) return result("That rule is not in your playbook.", true);
    await store.remove(userId, id); return result("Rule removed.");
  });
  server.registerTool("read_rule", { title: "Read one rule and its evidence", description: "Read a rule by ID from get_playbook, including stored evidence from a kept suggestion. Older or manually added rules may have no recorded evidence; do not invent where they came from.", inputSchema: idSchema, annotations: read }, async ({ id }) => {
    const rule = (await postgresRulesStore().list(userId)).find(r => r.id === id);
    return rule ? result({ ...rule, evidence: rule.learnedFrom ?? null }) : result("That rule is not in your playbook.", true);
  });
  server.registerTool("check_draft", {
    title: "Check a draft without saving",
    description: "Check text against the current playbook by meaning, with the same AI allowance and judging used when saving. Does not save, schedule or publish. Report refused, flagged, uncertain or passed exactly; then fix and check again. A later save checks again.",
    inputSchema: z.object({ text: z.string().trim().min(1).max(5000), network }), annotations: read,
  }, async ({ text, network }) => {
    const max = limitFor(network);
    if (max && text.length > max) return result({ status: "refused", reason: `Over ${network}'s ${max} character limit.`, saved: false }, true);
    const rules = rulesFor(await postgresRulesStore().list(userId), network);
    if (!rules.length) return result({ status: "not_checked", reason: "No rules apply to this network.", saved: false });
    const jm = await judgeModelFor(userId);
    if (!jm) return result("AI checking is unavailable. Check built-in AI or your own key in Settings.", true);
    try {
      const verdicts = (await judgeDrafts(jm.judges, [{ slotId: "try", text, network }], rules)).get("try") ?? [];
      const blocked = verdicts.some(v => v.level === "block" && v.verdict === "fail");
      const incomplete = verdicts.length !== rules.length;
      const status = blocked ? "refused" : incomplete || verdicts.some(v => v.verdict === "unsure" || v.unavailable) ? "uncertain" : verdicts.some(v => v.verdict === "fail") ? "flagged" : "passed";
      return result({ status, saved: false, verdicts, judgedWith: jm.source }, blocked);
    } catch (e) { await jm.giveBack(); throw e; }
    finally { await jm.settle(); }
  });
  server.registerTool("list_rule_suggestions", {
    title: "Find rules in my edits and posts",
    description: "List suggestions without keeping any. fixes reads repeated small edits from the saved queue; rewrites uses an AI action to learn from larger rewrites; past_posts reads recent Buffer posts and uses AI to find first rules. Show the evidence and ask which to keep. Use each returned token with keep_suggestion or dismiss_suggestion within an hour.",
    inputSchema: z.object({ mode: z.enum(["fixes", "rewrites", "past_posts"]).default("fixes") }), annotations: { ...read, openWorldHint: true },
  }, async ({ mode }) => {
    if (mode !== "fixes") {
      const l = await limit("ai", userId);
      if (!l.ok) return result("Too many AI requests just now. Try again in a minute.", true);
    }
    if (mode === "past_posts") {
      const l = await limit("bufferWrite", userId);
      if (!l.ok) return result("Too many Buffer requests just now. Try again in a minute.", true);
    }
    return result(await ruleSuggestions(userId, mode, () => buffer()));
  });
  server.registerTool("keep_suggestion", { title: "Keep a suggested rule", description: "Keep only a suggestion the user chose, using its exact token from list_rule_suggestions. Stores the evidence and applies the rule to future drafts.", inputSchema: suggestionSchema, annotations: { ...write, idempotentHint: true } }, async ({ token }) => { const r = await applySuggestion(userId, token, "keep"); return result(r, !r.ok); });
  server.registerTool("dismiss_suggestion", { title: "Dismiss a suggested rule", description: "Set aside a suggestion the user does not want, using its token from list_rule_suggestions. Does not delete any writing or existing rule.", inputSchema: suggestionSchema, annotations: { ...write, idempotentHint: true } }, async ({ token }) => { const r = await applySuggestion(userId, token, "dismiss"); return result(r, !r.ok); });
  server.registerTool("list_sources", { title: "List my connected feeds", description: "List every configured feed, including empty feeds, with IDs for remove_source.", annotations: read }, async () => result(await postgresSourceStore().list(userId)));
  server.registerTool("remove_source", { title: "Remove a connected feed", description: "Remove a feed the user requests by its ID from list_sources. Stops future reading of that feed; leaves existing drafts and saved research intact.", inputSchema: idSchema, annotations: remove }, async ({ id }) => {
    const store = postgresSourceStore();
    if (!(await store.list(userId)).some(s => s.id === id)) return result("That source is not in your account.", true);
    await store.remove(userId, id); return result("Source removed. Existing drafts are unchanged.");
  });
  server.registerTool("remove_material", { title: "Remove saved research", description: "Remove research the user requests, using its key from add_material or list_new_material. Only removes saved research text, not a feed item or any existing draft. Usage history remains, so re-adding identical used material does not offer it again.", inputSchema: z.object({ key: z.string().min(1).max(2000) }), annotations: remove }, async ({ key }) => {
    const store = postgresMaterialStore();
    if (!(await store.get(userId, key))) return result("That saved research is not in your account.", true);
    await store.remove(userId, key); return result("Saved research removed. Existing drafts are unchanged.");
  });
  server.registerTool("get_setup_status", { title: "Read my setup progress", description: "Open and close a workflow with the exact steps and count shown on Needs you. Never invent completion. Approval is a human step and stays incomplete in a drafts-only demo.", annotations: read }, async () => {
    const [b, sources, apps, voice] = await Promise.all([buffer(), postgresSourceStore().list(userId), approvedApps(userId), postgresVoiceStore().get(userId)]);
    const steps = setupReadiness(b, sources, apps, voice);
    return result({ done: steps.filter(s => s.state === "done").length, total: steps.length, steps, next: steps.find(s => s.state !== "done") ?? null });
  });
  server.registerTool("write_my_week", { title: "Write my week with Queue Pilot", description: "Run Queue Pilot's own Write my week action when the user explicitly asks it to write and save Buffer drafts. First get_setup_status, get_my_voice, get_playbook, list_new_material and list_open_slots. Uses the person's key or the metered built-in AI budget, the same writer and playbook gate as the button. Writes at most 10 empty slots next week per run, retries refused drafts once, and returns saved, flagged and refused results. It never schedules or publishes. Do not automatically repeat to fill more slots; report remaining slots and request another run.", annotations: write }, async () => {
    const l = await limit("bufferWrite", userId);
    if (!l.ok) return result("Too many Buffer requests just now. Try again in a minute.", true);
    const r = await writeSlotsForUser(() => buffer(true));
    return result(r, !r.ok || r.refused.length > 0);
  });
  server.registerTool("list_my_drafts", { title: "Read Queue Pilot drafts and checks", description: "List next week's drafts written by Queue Pilot with stored playbook verdicts. Changed text is marked so old verdicts are not presented as a fresh check. Never includes another app's drafts.", annotations: read }, async () => {
    const b = await buffer(); const range = nextWeekRange(new Date(), b.timeZone);
    const posts = postsBetween(b.posts, range.start, range.end).filter(p => p.status === "draft" && p.via === "api");
    const written = await postgresWrittenStore().get(userId, posts.map(p => p.id));
    return result({ asOf: b.fetchedAt.toISOString(), drafts: posts.flatMap(p => {
      const w = written.find(w => w.postId === p.id);
      return w ? [{ postId: p.id, channelId: p.channelId, text: p.text, dueAt: p.dueAt, status: p.status, changedSinceCheck: p.text !== w.text, verdicts: p.text === w.text ? w.verdicts ?? null : null }] : [];
    }) });
  });
  server.registerTool("refresh_buffer", { title: "Refresh Buffer data", description: "Refresh the saved queue after a user changes channels or slots in Buffer. Shares the app's request limit and keeps data under 30 seconds old. Use sparingly, then read the relevant tools.", annotations: { ...write, idempotentHint: true, openWorldHint: true } }, async () => { const b = await buffer(true); return result({ refreshedAt: b.fetchedAt.toISOString(), channels: b.channels.length }); });
  server.registerTool("list_channels", { title: "List my Buffer channels", description: "Read connected channels, timezones and posting schedules, including disconnection, lock and queue-paused flags. Reads the saved snapshot; use refresh_buffer for recent changes.", annotations: read }, async () => { const b = await buffer(); return result({ asOf: b.fetchedAt.toISOString(), channels: b.channels }); });
  server.registerTool("get_ai_usage", { title: "Read my AI allowance", description: "Read today's built-in AI usage and remaining shared dollar budget without spending an action. Reports whether an own key is saved, never the key. This is configuration and allowance information, not a successful live model test.", annotations: read }, async () => {
    const master = process.env.SETTINGS_KEY;
    const own = master ? await postgresAiKeyStore(master).get(userId) : null;
    return result({ ownKeySaved: !!own, selectedProvider: own?.provider ?? null, selectedModel: own?.model ?? null, builtIn: await allowanceFor(userId) });
  });
}
