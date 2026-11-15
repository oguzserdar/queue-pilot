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
/** The stored inheritance settings, or none when the row holds no object. */
export function inheritanceFrom(settings: unknown): Inheritance {
  return isInheritance(settings) ? settings : {};
}

function isInheritance(v: unknown): v is Inheritance {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
export type RuleDecision = { applies: boolean; origin: "shared" | "network" | "account"; reason: string };
type Origin = RuleDecision["origin"];

/** The level a rule is written at: exact accounts, named networks, or shared by every network. */
function originOf(rule: RuleRouting): Origin {
  if (rule.accountIds?.length) return "account";
  return rule.channels === "all" ? "shared" : "network";
}

/** The reason inheritance keeps the rule from this account, or null when it does not. */
function inheritanceOff(rule: RuleRouting, origin: Origin, network: string, accountId?: string): string | null {
  const inheritance = rule.inheritance;
  const account = accountId ? inheritance?.accounts?.[accountId] : undefined;
  if (origin === "shared" && (inheritance?.networks?.[network]?.shared === false || account?.shared === false)) return "Shared inheritance is off";
  if (origin === "network" && account?.network === false) return "Network inheritance is off";
  return null;
}

/** What an override for this account, or for this network on a shared rule, decides; null when none is set. */
function overrideDecision(rule: RuleRouting, origin: Origin, network: string, accountId?: string): { applies: boolean; reason: string } | null {
  const local = accountId ? rule.overrides?.accounts?.[accountId] : undefined;
  if (local !== undefined) return { applies: local, reason: local ? "Included for this account" : "Excluded for this account" };
  const net = rule.overrides?.networks?.[network];
  if (origin === "shared" && net !== undefined) return { applies: net, reason: net ? "Included for this network" : "Excluded for this network" };
  return null;
}

export function resolveRule(rule: RuleRouting, network: string, accountId?: string): RuleDecision {
  const origin = originOf(rule);
  const answer = (applies: boolean, reason: string): RuleDecision => ({ applies, origin, reason });
  if (origin === "account") return answer(!!accountId && (rule.accountIds ?? []).includes(accountId), "Only the named accounts");
  if (origin === "network" && !rule.channels.includes(network)) return answer(false, "Another network");
  const off = inheritanceOff(rule, origin, network, accountId);
  if (off !== null) return answer(false, off);
  const override = overrideDecision(rule, origin, network, accountId);
  if (override) return answer(override.applies, override.reason);
  return answer(origin !== "shared" || !(rule.except ?? []).includes(network), origin === "shared" && rule.except?.includes(network) ? "Excluded for this network" : "Inherited");
}
