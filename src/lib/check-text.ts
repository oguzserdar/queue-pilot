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

/** The outcome of one check. "refused" means a blocking rule or the length failed; nothing is saved either way. */
export type TextCheck =
  | { kind: "needs_channel"; message: string }
  | { kind: "unavailable"; message: string }
  | { kind: "checked"; status: "refused" | "flagged" | "uncertain" | "passed" | "not_checked"; reason?: string; channelId: string | null; scope: "account" | "network-only"; verdicts: Verdict[]; judgedWith?: string; playbookRevision: string; limit: { max: number | null; from: "buffer" | "built-in" } };

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
  const limit: { max: number | null; from: "buffer" | "built-in" } = !channelLimit ? { max: builtIn, from: "built-in" }
    : forOrdinarySave && builtIn !== null && builtIn < channelLimit ? { max: builtIn, from: "built-in" }
    : { max: channelLimit, from: "buffer" };
  if (limit.max && countFor(network, text) > limit.max) return { kind: "checked", status: "refused", reason: `Over ${limit.from === "buffer" ? "this account's" : `${network}'s`} ${limit.max} character limit.`, channelId: channelId ?? null, scope: channelId ? "account" : "network-only", verdicts: [], playbookRevision: revision, limit };
  const eligible = snap?.data.channels.filter(c => c.service === network && (!channelId || c.id === channelId)) ?? [];
  if ((channelId && eligible.length !== 1) || eligible.length > 1 || (!eligible.length && allRules.some(r => r.accountIds?.length || r.inheritance || r.overrides?.accounts)))
    return { kind: "needs_channel", message: "Choose one exact channelId from list_channels so the correct account rules are checked." };
  const channel = eligible[0]?.id;
  const scope = channel ? "account" : "network-only";
  const rules = rulesFor(allRules, network, channel);
  if (!rules.length) return { kind: "checked", status: "not_checked", reason: "No rules apply to this network.", channelId: channel ?? null, scope, verdicts: [], playbookRevision: revision, limit };
  const jm = await judgeModelFor(userId);
  if (!jm) return { kind: "unavailable", message: "AI checking is unavailable. Check built-in AI or your own key in Settings." };
  try {
    const verdicts = (await judgeDrafts(jm.judges, [{ slotId: "try", text, network, channelId: channel }], rules)).get("try") ?? [];
    const blocked = verdicts.some(v => v.level === "block" && v.verdict === "fail");
    const incomplete = verdicts.length !== rules.length;
    const status = blocked ? "refused" : incomplete || verdicts.some(v => v.verdict === "unsure" || v.unavailable) ? "uncertain" : verdicts.some(v => v.verdict === "fail") ? "flagged" : "passed";
    return { kind: "checked", status, channelId: channel ?? null, scope, verdicts, judgedWith: jm.source, playbookRevision: revision, limit };
  } catch (e) { await jm.giveBack(); throw e; }
  finally { await jm.settle(); }
}
