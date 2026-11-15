/**
 * @fileoverview One playbook check of a piece of text: its length, counted the way Buffer counts it for the network
 * (weighted links, emoji, Instagram line breaks), then the person's rules for that network or exact account, judged
 * by meaning. Shared by check_draft, fill_post_template and the content-item promote.
 *
 * Which limit applies depends on where the text will be saved. Promotion saves through Buffer directly, so it uses the
 * account's own limit from Buffer. check_draft and fill_post_template come before the ordinary save (save_drafts,
 * update_draft), which still uses the built-in table, so they use the stricter of the two: a check never passes text
 * that save would refuse.
 */
import { postgresSnapshotStore } from "./buffer/snapshot-store";
import { postgresRulesStore } from "./rules-store";
import { judgeDrafts, rulesFor } from "./judge";
import { judgeModelFor } from "./judge-model";
import { countFor, limitFor } from "./char-limits";
import { playbookVersion } from "./playbook-version";
import type { Verdict } from "./judge";
import type { Rule } from "./rules";

/** The outcome of one check. "refused" means a blocking rule or the length failed; nothing is saved either way. */
export type TextCheck =
  | { kind: "needs_channel"; message: string }
  | { kind: "unavailable"; message: string }
  | { kind: "checked"; status: "refused" | "flagged" | "uncertain" | "passed" | "not_checked"; reason?: string; channelId: string | null; scope: "account" | "network-only"; verdicts: Verdict[]; judgedWith?: string; playbookRevision: string; limit: { max: number | null; from: "buffer" | "built-in" } };

type SaveLimit = { max: number | null; from: "buffer" | "built-in" };

/** The text limit a check holds the draft to: the account's own limit, or the built-in one when stricter for a save. */
function saveLimit(builtIn: number | null, channelLimit: number | null | undefined, forOrdinarySave: boolean): SaveLimit {
  if (!channelLimit) return { max: builtIn, from: "built-in" };
  if (forOrdinarySave && builtIn !== null && builtIn < channelLimit) return { max: builtIn, from: "built-in" };
  return { max: channelLimit, from: "buffer" };
}

/** Why a draft over its limit is refused, naming whose limit it is. */
function overLimitReason(max: number, from: SaveLimit["from"], network: string, channelLimit: number | null | undefined): string {
  if (from === "buffer") return `Over this account's ${max} character limit.`;
  if (channelLimit && channelLimit > max) return `Over Queue Pilot's current save limit of ${max} characters for ${network}. Buffer allows this account ${channelLimit}, but drafts saved into open slots are still checked at ${max}.`;
  return `Over ${network}'s ${max} character limit.`;
}

/** True when the text cannot be checked without one exact account: a named one that matches no single account, more
 * than one match, or no match while some rule is written for exact accounts. */
function needsExactChannel(matches: number, channelId: string | undefined, rules: Rule[]): boolean {
  if (channelId && matches !== 1) return true;
  if (matches > 1) return true;
  return !matches && rules.some(r => r.accountIds?.length || r.inheritance || r.overrides?.accounts);
}

/** The check's status: refused by a blocking rule, uncertain when a verdict is missing or unsure, flagged, or passed. */
function statusOf(verdicts: Verdict[], ruleCount: number): "refused" | "uncertain" | "flagged" | "passed" {
  if (verdicts.some(v => v.level === "block" && v.verdict === "fail")) return "refused";
  if (verdicts.length !== ruleCount || verdicts.some(v => v.verdict === "unsure" || v.unavailable)) return "uncertain";
  if (verdicts.some(v => v.verdict === "fail")) return "flagged";
  return "passed";
}

/**
 * Checks text against the person's playbook for one network, and one exact account when given.
 *
 * @param userId - The person
 * @param text - The text to check
 * @param network - The network, such as linkedin
 * @param channelId - The exact account, required when account-level rules exist
 * @param channelLimit - The account's own post text limit from Buffer's channel configuration, when known
 * @param forOrdinarySave - True when the text will go through save_drafts or update_draft: the stricter of the
 *   account's limit and the built-in table applies
 * @returns The verdicts, or why no check could run
 */
export async function checkText(userId: string, text: string, network: string, channelId?: string, channelLimit?: number | null, forOrdinarySave = false): Promise<TextCheck> {
  const [snap, allRules] = await Promise.all([postgresSnapshotStore().get(userId), postgresRulesStore().list(userId)]);
  const revision = playbookVersion(allRules);
  const builtIn = limitFor(network);
  const limit = saveLimit(builtIn, channelLimit, forOrdinarySave);
  if (limit.max && countFor(network, text) > limit.max) return { kind: "checked", status: "refused", reason: overLimitReason(limit.max, limit.from, network, channelLimit), channelId: channelId ?? null, scope: channelId ? "account" : "network-only", verdicts: [], playbookRevision: revision, limit };
  const eligible = snap?.data.channels.filter(c => c.service === network && (!channelId || c.id === channelId)) ?? [];
  if (needsExactChannel(eligible.length, channelId, allRules))
    return { kind: "needs_channel", message: "Choose one exact channelId from list_channels so the correct account rules are checked." };
  const channel = eligible[0]?.id;
  const scope = channel ? "account" : "network-only";
  const rules = rulesFor(allRules, network, channel);
  if (!rules.length) return { kind: "checked", status: "not_checked", reason: "No rules apply to this network.", channelId: channel ?? null, scope, verdicts: [], playbookRevision: revision, limit };
  const jm = await judgeModelFor(userId);
  if (!jm) return { kind: "unavailable", message: "AI checking is unavailable. Check built-in AI or your own key in Settings." };
  try {
    const verdicts = (await judgeDrafts(jm.judges, [{ slotId: "try", text, network, channelId: channel }], rules)).get("try") ?? [];
    const status = statusOf(verdicts, rules.length);
    return { kind: "checked", status, channelId: channel ?? null, scope, verdicts, judgedWith: jm.source, playbookRevision: revision, limit };
  } catch (e) { await jm.giveBack(); throw e; }
  finally { await jm.settle(); }
}
