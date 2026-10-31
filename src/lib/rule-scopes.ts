/** Shared → network → exact account. Inheritance is a boundary; overrides never cross it. */
export type Inheritance = { networks?: Record<string, { shared: boolean }>; accounts?: Record<string, { shared: boolean; network: boolean }> };
export type RuleRouting = {
  channels: string[] | "all";
  accountIds?: string[];
  except?: string[];
  overrides?: { networks?: Record<string, boolean>; accounts?: Record<string, boolean> };
  /** Hydrated from this owner's settings. Never accepted from a client. */
  inheritance?: Inheritance;
};
export type RuleDecision = { applies: boolean; origin: "shared" | "network" | "account"; reason: string };
export function resolveRule(rule: RuleRouting, network: string, accountId?: string): RuleDecision {
  const origin = rule.accountIds?.length ? "account" : rule.channels === "all" ? "shared" : "network";
  const answer = (applies: boolean, reason: string): RuleDecision => ({ applies, origin, reason });
  if (origin === "account") return answer(!!accountId && rule.accountIds!.includes(accountId), "Only the named accounts");
  if (origin === "network" && !rule.channels.includes(network)) return answer(false, "Another network");
  const inheritance = rule.inheritance;
  const account = accountId ? inheritance?.accounts?.[accountId] : undefined;
  if (origin === "shared" && (inheritance?.networks?.[network]?.shared === false || account?.shared === false)) return answer(false, "Shared inheritance is off");
  if (origin === "network" && account?.network === false) return answer(false, "Network inheritance is off");
  const local = accountId ? rule.overrides?.accounts?.[accountId] : undefined;
  if (local !== undefined) return answer(local, local ? "Included for this account" : "Excluded for this account");
  const net = rule.overrides?.networks?.[network];
  if (origin === "shared" && net !== undefined) return answer(net, net ? "Included for this network" : "Excluded for this network");
  return answer(origin !== "shared" || !(rule.except ?? []).includes(network), origin === "shared" && rule.except?.includes(network) ? "Excluded for this network" : "Inherited");
}
