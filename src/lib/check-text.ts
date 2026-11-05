/**
 * @fileoverview One playbook check of a piece of text, the same way saving checks it: the network's character limit,
 * then the person's rules for that network or exact account, judged by meaning. Shared by check_draft,
 * fill_post_template and the content-item promote, so no path can check more loosely than another.
 */
import { postgresSnapshotStore } from "./buffer/snapshot-store";
import { postgresRulesStore } from "./rules-store";
import { judgeDrafts, rulesFor } from "./judge";
import { judgeModelFor } from "./judge-model";
import { limitFor } from "./char-limits";
import { playbookVersion } from "./playbook-version";
import type { Verdict } from "./judge";

/** The outcome of one check. "refused" means a blocking rule or the length failed; nothing is saved either way. */
export type TextCheck =
  | { kind: "needs_channel"; message: string }
  | { kind: "unavailable"; message: string }
  | { kind: "checked"; status: "refused" | "flagged" | "uncertain" | "passed" | "not_checked"; reason?: string; channelId: string | null; scope: "account" | "network-only"; verdicts: Verdict[]; judgedWith?: string; playbookRevision: string };

/**
 * Checks text against the person's playbook for one network, and one exact account when given.
 *
 * @param userId - The person
 * @param text - The text to check
 * @param network - The network, such as linkedin
 * @param channelId - The exact account, required when account-level rules exist
 * @returns The verdicts, or why no check could run
 */
export async function checkText(userId: string, text: string, network: string, channelId?: string): Promise<TextCheck> {
  const [snap, allRules] = await Promise.all([postgresSnapshotStore().get(userId), postgresRulesStore().list(userId)]);
  const revision = playbookVersion(allRules);
  const max = limitFor(network);
  if (max && text.length > max) return { kind: "checked", status: "refused", reason: `Over ${network}'s ${max} character limit.`, channelId: channelId ?? null, scope: channelId ? "account" : "network-only", verdicts: [], playbookRevision: revision };
  const eligible = snap?.data.channels.filter(c => c.service === network && (!channelId || c.id === channelId)) ?? [];
  if ((channelId && eligible.length !== 1) || eligible.length > 1 || (!eligible.length && allRules.some(r => r.accountIds?.length || r.inheritance || r.overrides?.accounts)))
    return { kind: "needs_channel", message: "Choose one exact channelId from list_channels so the correct account rules are checked." };
  const channel = eligible[0]?.id;
  const scope = channel ? "account" : "network-only";
  const rules = rulesFor(allRules, network, channel);
  if (!rules.length) return { kind: "checked", status: "not_checked", reason: "No rules apply to this network.", channelId: channel ?? null, scope, verdicts: [], playbookRevision: revision };
  const jm = await judgeModelFor(userId);
  if (!jm) return { kind: "unavailable", message: "AI checking is unavailable. Check built-in AI or your own key in Settings." };
  try {
    const verdicts = (await judgeDrafts(jm.judges, [{ slotId: "try", text, network, channelId: channel }], rules)).get("try") ?? [];
    const blocked = verdicts.some(v => v.level === "block" && v.verdict === "fail");
    const incomplete = verdicts.length !== rules.length;
    const status = blocked ? "refused" : incomplete || verdicts.some(v => v.verdict === "unsure" || v.unavailable) ? "uncertain" : verdicts.some(v => v.verdict === "fail") ? "flagged" : "passed";
    return { kind: "checked", status, channelId: channel ?? null, scope, verdicts, judgedWith: jm.source, playbookRevision: revision };
  } catch (e) { await jm.giveBack(); throw e; }
  finally { await jm.settle(); }
}
