"use server";

import { revalidatePath } from "next/cache";
import { waitMessage, waitRefusal } from "@/lib/buffer/not-sent";
import { bufferForWriting, signedInUserId } from "@/lib/current-user";
import { aiErrorMessage } from "@/lib/ai-model";
import { APICallError, NoObjectGeneratedError } from "ai";
import { wroteIds } from "@/lib/written-store";
import { listRecentSent } from "@/lib/buffer/queries";
import { postgresSnapshotStore } from "@/lib/buffer/snapshot-store";
import { postgresRulesStore, TooManyRulesError } from "@/lib/rules-store";
import { NETWORKS, parseNewRule, type NewRule } from "@/lib/rules";
import { structureRule } from "@/lib/structure-rule";
import { judgeDrafts, type Verdict } from "@/lib/judge";
import { AiCapError, judgeModelFor } from "@/lib/judge-model";
import { currentRewrites } from "@/lib/read-back";
import { proposeRules } from "@/lib/rewrite-rules";
import { channelsByOrganization, firstRuleKey, pastPosts, proposeFirstRules } from "@/lib/day-one-rules";
import { overLimit, tooMany } from "./action-limits";
import type { SourceActionResult } from "./actions";

/** Adds a rule to the signed-in user's playbook. Every draft is checked against it before it is saved in Buffer. */
export async function addRule(input: unknown): Promise<SourceActionResult> {
  const userId = await signedInUserId();
  if (!userId) return { ok: false, message: "Sign in with Buffer first." };
  const parsed = parseNewRule(input);
  if (typeof parsed === "string") return { ok: false, message: parsed };
  let id: string;
  try {
    const reading = typeof input === "object" && input !== null && "reading" in input ? input.reading : undefined;
    id = await postgresRulesStore().add(userId, { ...(await readingOrTyped(userId, parsed, reading)), addedBy: "you" });
  } catch (e) {
    if (e instanceof TooManyRulesError) return { ok: false, message: e.message };
    console.error(JSON.stringify({ event: "qp-rule-add-failed", message: e instanceof Error ? e.message : String(e) }));
    return { ok: false, message: "Queue Pilot could not save that rule just now. Try again in a minute." };
  }
  revalidatePath("/playbook");
  return { ok: true, id };
}

/**
 * The reading the person saw while typing, when the form sends one: a typed reading is checked like any input and keeps
 * their sentence as its text, and a "guidance" reading means they chose to keep the rule as written. Without one, the
 * rule is read on the server.
 */
async function readingOrTyped(userId: string, rule: NewRule, reading: unknown): Promise<NewRule> {
  if (rule.kind !== "guidance" || !reading || typeof reading !== "object") return typedIfPossible(userId, rule);
  if ("kind" in reading && reading.kind === "guidance") return rule;
  // A reading the form saw is a whole rule (a banned one holds `phrases`); turn it back into parser input before checking it.
  const typed = parseNewRule({ ...readingInput(reading), channels: rule.channels, accountIds: rule.accountIds, except: rule.except, overrides: rule.overrides, level: rule.level });
  return typeof typed === "string" || typed.kind === "guidance" ? typedIfPossible(userId, rule) : { ...typed, text: rule.text };
}

/** A reading as the parser takes it: a banned rule's first phrase as its `phrase`, any other reading as it is. */
function readingInput(reading: object): object {
  if (!("kind" in reading) || reading.kind !== "banned" || !("phrases" in reading) || !Array.isArray(reading.phrases)) return reading;
  const { phrases, ...rest } = reading;
  return { ...rest, phrase: phrases[0] };
}

/** How a rule in the person's words reads, for the form to show while they type; null when it cannot be read now. */
export async function readRule(text: unknown): Promise<NewRule | null> {
  const userId = await signedInUserId();
  if (!userId || typeof text !== "string" || text.trim().length < 4 || text.length > 200) return null;
  const parsed = parseNewRule({ kind: "guidance", text, channels: "all", level: "warn" });
  if (typeof parsed === "string") return null;
  // The live preview runs while the person types, so it never spends the built-in key: only their own key previews.
  return typedIfPossible(userId, parsed, { ownKeyOnly: true });
}

/** A rule in the person's words read into a typed rule with their AI; kept as written without a key, over the limit, or on any failure. */
async function typedIfPossible(userId: string, rule: NewRule, opts: { ownKeyOnly?: boolean } = {}): Promise<NewRule> {
  if (rule.kind !== "guidance" || (await overLimit("ai"))) return rule;
  const jm = await judgeModelFor(userId, opts).catch(() => null);
  if (!jm) return rule;
  try {
    return await structureRule(jm.judges.explainer, rule);
  } finally {
    await jm.settle();
  }
}

/** Deletes one of the signed-in user's rules; another person's rule id deletes nothing. */
export async function removeRule(id: string): Promise<SourceActionResult> {
  const userId = await signedInUserId();
  if (!userId) return { ok: false, message: "Sign in with Buffer first." };
  if (typeof id !== "string" || id.length > 100) return { ok: false, message: "Unknown rule." };
  try {
    await postgresRulesStore().remove(userId, id);
  } catch (e) {
    console.error(JSON.stringify({ event: "qp-rule-remove-failed", message: e instanceof Error ? e.message : String(e) }));
    return { ok: false, message: "Queue Pilot could not delete that rule just now. Try again in a minute." };
  }
  revalidatePath("/playbook");
  return { ok: true };
}

/** Switches one of the person's shared rules off for a network, or back on. */
export async function setRuleException(id: string, network: string, off: boolean): Promise<SourceActionResult> {
  const userId = await signedInUserId();
  if (!userId) return { ok: false, message: "Sign in with Buffer first." };
  if (typeof id !== "string" || id.length > 100 || typeof network !== "string" || !(network in NETWORKS) || typeof off !== "boolean") return { ok: false, message: "Unknown rule." };
  try {
    if (!(await postgresRulesStore().setException(userId, id, network, off))) return { ok: false, message: "Only a rule for every network can be switched off for one." };
  } catch (e) {
    console.error(JSON.stringify({ event: "qp-rule-exception-failed", message: e instanceof Error ? e.message : String(e) }));
    return { ok: false, message: "Queue Pilot could not change that rule just now. Try again in a minute." };
  }
  revalidatePath("/playbook");
  return { ok: true };
}

/** The account a tried draft is for: the one picked, or the only one on that network. */
function channelFor<C extends { id: string }>(channels: C[], channelId: string | undefined): C | undefined {
  if (channelId) return channels.find(c => c.id === channelId);
  return channels.length === 1 ? channels[0] : undefined;
}

/** Where a proposed rule would apply, in words. */
function proposalWhere(rule: { accountIds?: string[]; channels: string[] | "all" }): string {
  if (rule.accountIds?.length) return "Selected account";
  return rule.channels === "all" ? "Every network" : rule.channels.map((c) => NETWORKS[c] ?? c).join(", ");
}

export type TryDraftResult = { ok: true; verdicts: Verdict[]; judgedWith: string } | { ok: false; message: string };

/** Try a draft: judges typed text against the person's playbook with the same model check saves get. */
export async function tryDraft(text: string, network: string, channelId?: string): Promise<TryDraftResult> {
  { const l = await overLimit("ai"); if (l) return tooMany(l); }
  const userId = await signedInUserId();
  if (!userId) return { ok: false, message: "Sign in with Buffer first." };
  if (typeof text !== "string" || !text.trim() || text.length > 5000 || typeof network !== "string" || !(network in NETWORKS)) return { ok: false, message: "Type a draft to check." };
  const snapshot = await postgresSnapshotStore().get(userId);
  const channels = snapshot?.data.channels.filter(c => c.service === network) ?? [];
  const channel = channelFor(channels, channelId);
  if (!channel) return { ok: false, message: "Choose the connected account this draft is for." };
  const rules = await postgresRulesStore().list(userId).catch(() => null);
  if (!rules) return { ok: false, message: "Could not read your playbook just now. Try again." };
  if (!rules.length) return { ok: false, message: "Your playbook has no rules yet." };
  const jm = await judgeModelFor(userId).catch((e) => (e instanceof AiCapError ? e : null));
  if (jm instanceof AiCapError) return { ok: false, message: jm.message };
  if (!jm) return { ok: false, message: "Add your AI key in Settings: a model judges each draft against your rules." };
  try {
    const v = await judgeDrafts(jm.judges, [{ slotId: "try", text, network, channelId: channel.id }], rules);
    return { ok: true, verdicts: v.get("try") ?? [], judgedWith: jm.source };
  } catch (e) {
    await jm.giveBack();
    return { ok: false, message: aiErrorMessage(e, jm.cfg.provider) };
  } finally {
    await jm.settle();
  }
}

export type RewriteProposal = { accountIds?: string[]; text: string; channels: string[] | "all"; where: string; examples: { before: string; after: string }[] };

/** Find rules in my rewrites: a model reads the drafts the person rewrote and proposes rules they can keep. */
export async function findRulesInRewrites(): Promise<{ ok: true; proposals: RewriteProposal[]; read: number } | { ok: false; message: string }> {
  { const l = await overLimit("ai"); if (l) return tooMany(l); }
  const userId = await signedInUserId();
  if (!userId) return { ok: false, message: "Sign in with Buffer first." };
  const { rewrites, rules } = await currentRewrites(userId).catch(() => ({ rewrites: [], rules: [] }));
  if (rewrites.length < 2) return { ok: false, message: "Rewrite at least two of Queue Pilot's drafts in Buffer first. Small fixes are offered above on their own." };
  const jm = await judgeModelFor(userId).catch((e) => (e instanceof AiCapError ? e : null));
  if (jm instanceof AiCapError) return { ok: false, message: jm.message };
  if (!jm) return { ok: false, message: "Add your AI key in Settings: a model reads your rewrites." };
  try {
    const found = await proposeRules(jm.judges.explainer, rewrites, rules);
    return {
      ok: true,
      read: rewrites.length,
      proposals: found.map((p) => ({
        text: p.rule.text,
        channels: p.rule.channels,
        accountIds: p.rule.accountIds,
        where: proposalWhere(p.rule),
        examples: p.evidence.map((e) => ({ before: e.before, after: e.after })),
      })),
    };
  } catch (e) {
    await jm.giveBack();
    return { ok: false, message: aiErrorMessage(e, jm.cfg.provider) };
  } finally {
    await jm.settle();
  }
}

export type FirstRuleOffer = {
  accountIds?: string[];
  text: string;
  channels: string[];
  where: string;
  key: string;
  proof: { kind: "posts"; followed: number; of: number; unclear: number; unclearPosts: string[]; examples: string[] } | { kind: "note"; note: string; by: string | null; at: string | null; post: string };
};

/** Find my first rules: a model reads the person's recent sent posts and their teammates' notes in Buffer, and each rule comes back with its proof. */
export async function findFirstRules(): Promise<{ ok: true; offers: FirstRuleOffer[]; skipped: string[] } | { ok: false; message: string }> {
  { const l = await overLimit("ai"); if (l) return tooMany(l); }
  const b = await bufferForWriting().catch((e) => waitRefusal(e) ?? null);
  if (b && "message" in b) return { ok: false, message: waitMessage(b) };
  if (!b) return { ok: false, message: "Sign in with Buffer first." };
  const jm = await judgeModelFor(b.userId).catch((e) => (e instanceof AiCapError ? e : null));
  if (jm instanceof AiCapError) return { ok: false, message: jm.message };
  if (!jm) return { ok: false, message: "Add your AI key in Settings: a model reads your posts." };
  try {
    const sent = (await Promise.all([...channelsByOrganization(b.channels)].map(([org, ids]) => listRecentSent(b.token, org, ids)))).flat();
    if (!sent.length) return { ok: false, message: "Buffer has no sent posts for your channels yet." };
    // Posts Queue Pilot wrote are not the person's voice, so they teach nothing.
    const ours = await wroteIds(b.userId, ...sent.map((p) => p.id));
    const [rules, dismissed] = await Promise.all([postgresRulesStore().list(b.userId).catch(() => []), postgresRulesStore().dismissed(b.userId).catch(() => new Set<string>())]);
    const { offers, skipped } = await proposeFirstRules(jm.judges.explainer, jm.judges, pastPosts(b.channels, sent.filter((p) => !ours.has(p.id))), rules);
    return {
      ok: true,
      skipped: skipped.map((n) => NETWORKS[n] ?? n),
      offers: offers.filter(({ rule }) => !dismissed.has(firstRuleKey(rule))).map(({ rule, proof }) => {
        const channels = rule.channels === "all" ? [] : rule.channels;
        return {
          text: rule.text,
          accountIds: rule.accountIds,
          channels,
          where: rule.accountIds?.length ? rule.accountIds.map(id => b.channels.find(c => c.id === id)?.name ?? "Account").join(", ") : channels.map((c) => NETWORKS[c] ?? c).join(", "),
          key: firstRuleKey(rule),
          proof,
        };
      }),
    };
  } catch (e) {
    { const w = waitRefusal(e); if (w) return { ok: false, message: waitMessage(w) }; }
    await jm.giveBack();
    if (APICallError.isInstance(e) || NoObjectGeneratedError.isInstance(e)) return { ok: false, message: aiErrorMessage(e, jm.cfg.provider) };
    console.error(JSON.stringify({ event: "qp-first-rules-failed", message: e instanceof Error ? e.message : String(e) }));
    return { ok: false, message: "Could not read your posts just now. Try again." };
  } finally {
    await jm.settle();
  }
}

/** Not now on a first rule: it is not offered again. */
export async function dismissFirstRule(key: string): Promise<SourceActionResult> {
  const userId = await signedInUserId();
  if (!userId) return { ok: false, message: "Sign in with Buffer first." };
  if (typeof key !== "string" || !key.startsWith("first:") || key.length > 500) return { ok: false, message: "Unknown rule." };
  try {
    await postgresRulesStore().dismiss(userId, key);
  } catch (e) {
    console.error(JSON.stringify({ event: "qp-dismiss-first-rule-failed", message: e instanceof Error ? e.message : String(e) }));
    return { ok: false, message: "Queue Pilot could not save that just now. Try again in a minute." };
  }
  return { ok: true };
}
