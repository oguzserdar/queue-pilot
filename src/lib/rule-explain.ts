/**
 * Plain words for why a rule does or does not apply to one exact account, for every screen that lists rules for an
 * account. A rule that belongs to another account or another network is not this account's business, so it is left
 * out rather than shown as "excluded".
 */
import { resolveRule, type RuleRouting } from "./rule-scopes";
import { NETWORKS } from "./rules";

export type RuleLine<R> = { rule: R; applies: boolean; from: string; why: string };

/** Where a rule comes from, as the person names the level: shared, the network's rules, or this account. */
export function ruleSource(origin: "shared" | "network" | "account", network: string): string {
  if (origin === "shared") return "Shared rule";
  if (origin === "network") return `${NETWORKS[network] ?? network} rule`;
  return "This account's rule";
}

/** Why a rule applies to this account, in the words the account's rule list shows. */
function whyApplies(reason: string): string {
  if (reason === "Inherited") return "Applies here";
  if (reason === "Only the named accounts") return "Written for this account";
  return reason;
}

/** Why a rule is switched off for this account, in the words the account's rule list shows. */
function whyOff(reason: string, network: string): string {
  if (reason === "Shared inheritance is off") return "Off: this account doesn't use shared rules";
  if (reason === "Network inheritance is off") return `Off: this account doesn't use ${NETWORKS[network] ?? network} rules`;
  return `Off: ${reason.charAt(0).toLowerCase()}${reason.slice(1)}`;
}

/**
 * The rules that concern this account: the ones that apply, then the ones switched off for it, each with its source
 * and a short reason. Rules for another account or network are left out.
 */
export function rulesForAccount<R extends RuleRouting>(rules: R[], network: string, accountId: string): RuleLine<R>[] {
  const lines = rules.flatMap((rule) => {
    const d = resolveRule(rule, network, accountId);
    if (!d.applies && (d.reason === "Only the named accounts" || d.reason === "Another network")) return [];
    const why = d.applies ? whyApplies(d.reason) : whyOff(d.reason, network);
    return [{ rule, applies: d.applies, from: ruleSource(d.origin, network), why }];
  });
  return [...lines.filter((l) => l.applies), ...lines.filter((l) => !l.applies)];
}
