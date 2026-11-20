/**
 * Playbook rules: what a person wants every draft to follow. Kinds are a banned phrase, a word to replace, a required
 * ending, and a rule in the person's own words. No rule is checked by matching
 * text: a decision model judges every rule by meaning, in the draft's own language (src/lib/judge.ts).
 */

import { resolveRule, type RuleRouting } from "./rule-scopes";
import type { AddedBy } from "./rule-origin";

export type RuleLevel = "block" | "warn";

type RuleBase = RuleRouting & {
  /** Evidence saved only by the server when a suggestion is kept. */
  learnedFrom?: unknown;
  /** Who added the rule by hand ("you", or an AI app by name). Set only by the server, never parsed from input. */
  addedBy?: AddedBy;
  id: string;
  /** The rule as the person reads it in their playbook. */
  text: string;
  /** Legacy network names, or "all". Exact accounts use accountIds. */
  channels: string[] | "all";
  /** For a rule on every network: the networks it is switched off for. A rule for named networks has none. */
  except?: string[];
  /** block: a failing draft is not saved. warn: it is saved and the failure is shown. */
  level: RuleLevel;
};

export type Rule =
  /** where: the whole post (default), or only its opening or its ending, as rule checkers anchor a ban by position. */
  | (RuleBase & { kind: "banned"; phrases: string[]; where?: "start" | "end" })
  | (RuleBase & { kind: "replace"; from: string; to: string })
  | (RuleBase & { kind: "ends_with"; phrase: string })
  | (RuleBase & { kind: "guidance" });

/** A rule before it has an id: Omit applied to each kind, so every kind keeps its own fields. */
export type NewRule = Rule extends infer R ? (R extends Rule ? Omit<R, "id"> : never) : never;

export const NETWORKS: Record<string, string> = {
  linkedin: "LinkedIn",
  instagram: "Instagram",
  twitter: "X",
  bluesky: "Bluesky",
  threads: "Threads",
  facebook: "Facebook",
  mastodon: "Mastodon",
};

/** Whether a rule applies to a draft on this network: a shared rule applies everywhere it is not switched off. */
export function appliesTo(rule: RuleRouting, network: string, accountId?: string): boolean {
  return resolveRule(rule, network, accountId).applies;
}

/**
 * Where a rule applies, in plain words: "every network", "every network except X", the networks it names, or the
 * accounts it is limited to.
 *
 * @param rule - The rule's routing
 * @param accounts - Account names by account id, when known; an account not in it is counted, not named
 * @returns The scope as one short phrase
 */
export function ruleScope(rule: RuleRouting, accounts?: ReadonlyMap<string, string>): string {
  if (rule.accountIds?.length) {
    const named = rule.accountIds.flatMap((id) => accounts?.get(id) ?? []);
    const others = rule.accountIds.length - named.length;
    const rest = others ? [`${others} ${named.length ? "other " : ""}selected account${others === 1 ? "" : "s"}`] : [];
    return [...named, ...rest].join(", ");
  }
  if (rule.channels !== "all") return rule.channels.map((c) => NETWORKS[c] ?? c).join(", ");
  const off = (rule.except ?? []).map((c) => NETWORKS[c] ?? c);
  return off.length ? `every network except ${off.join(", ")}` : "every network";
}

/** What happens to a draft that breaks the rule, in the words the Playbook shows. */
export function ruleHold(rule: Rule): "Blocks drafts" | "Flags drafts" {
  return rule.level === "block" ? "Blocks drafts" : "Flags drafts";
}

const MAX_PHRASE = 120;
/** The most characters one rule in the person's own words may hold; the rule form says so when the text reaches it. */
export const MAX_RULE_TEXT = 200;
const MAX_TEXT = MAX_RULE_TEXT;

/**
 * A stored or read rule as parseNewRule's input, so a rule can be checked again and come back unchanged: a banned rule
 * keeps its one phrase in `phrases`, while the input names it `phrase`.
 *
 * @param rule - A rule as stored or as returned by a reading
 * @returns Raw input that parseNewRule turns back into the same rule
 */
export function ruleInput(rule: NewRule): Record<string, unknown> {
  if (rule.kind !== "banned") return { ...rule };
  const { phrases, ...rest } = rule;
  return { ...rest, phrase: phrases[0] };
}

/** Whether a value is an object whose fields can be read by name. */
function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

const RULE_KINDS = ["banned", "replace", "ends_with", "guidance"] as const;

/**
 * A rule as stored in the rules table. Only the rules store writes it, from a rule parseNewRule checked, so its kind
 * tells which rule it is; anything else means the row is damaged.
 *
 * @param spec - The stored spec column
 * @returns The rule, unchanged
 * @throws Error when the stored value is not a rule
 */
export function storedRuleSpec(spec: unknown): NewRule {
  if (!isRuleSpec(spec)) throw new Error("A stored rule could not be read.");
  return spec;
}

function isRuleSpec(v: unknown): v is NewRule {
  return isObject(v) && RULE_KINDS.some((k) => k === v.kind);
}

/**
 * Turns form or tool input into a rule, or a sentence saying what to fix. Input is never trusted: every field is
 * checked for type and length, and the networks must be ones Queue Pilot knows.
 */
export function parseNewRule(input: unknown): NewRule | string {
  let rule = parseRuleBody(input);
  if (typeof rule === "string") return rule;
  // parseRuleBody only answers a rule for an object, so this always holds.
  const fields: Record<string, unknown> = isObject(input) ? input : {};
  if (fields.overrides !== undefined) {
    const overrides = parseOverrides(fields.overrides);
    if (typeof overrides === "string") return overrides;
    rule = { ...rule, overrides };
  }
  const ids = fields.accountIds;
  if (ids !== undefined) {
    if (!Array.isArray(ids) || !ids.length || ids.length > 30 || ids.some(id => typeof id !== "string" || !id || id.length > 200)) return "Choose valid accounts.";
    return { ...rule, channels: "all", accountIds: [...new Set(ids)] };
  }
  if (rule.channels !== "all") return rule;
  // A shared rule may come back with the networks it was switched off for (an undo, a restored rule).
  const raw = fields.except;
  const except = Array.isArray(raw) ? [...new Set(raw.filter((c): c is string => typeof c === "string" && c in NETWORKS))] : [];
  return except.length ? { ...rule, except } : rule;
}

/** A rule's exceptions per network and per account, checked, or the sentence saying they are invalid. */
function parseOverrides(overrides: unknown): NonNullable<RuleRouting["overrides"]> | string {
  if (!overrides || typeof overrides !== "object" || Array.isArray(overrides)) return "Invalid rule exceptions.";
  const groups: Record<string, unknown> = isObject(overrides) ? overrides : {};
  const clean: NonNullable<RuleRouting["overrides"]> = {};
  for (const group of ["networks", "accounts"] as const) {
    const map = groups[group];
    if (map === undefined) continue;
    if (!map || typeof map !== "object" || Array.isArray(map) || Object.keys(map).length > 50) return "Invalid rule exceptions.";
    const entries = Object.entries(map);
    if (entries.some(([key, value]) => !key || key.length > 200 || typeof value !== "boolean" || (group === "networks" && !Object.hasOwn(NETWORKS, key)))) return "Invalid rule exceptions.";
    clean[group] = Object.fromEntries(entries.filter((e): e is [string, boolean] => typeof e[1] === "boolean"));
  }
  return clean;
}

/** The rule's networks: "all", the named networks, or null when the field is neither. */
function parseChannels(raw: unknown): string[] | "all" | null {
  if (raw === "all") return "all";
  return Array.isArray(raw) ? raw.filter((c): c is string => typeof c === "string") : null;
}

/** The text a banned rule shows, by where the phrase is banned. */
function bannedText(phrase: string, where: "start" | "end" | undefined): string {
  if (where === "start") return `Never start with "${phrase}".`;
  if (where === "end") return `Never end with "${phrase}".`;
  return `Never "${phrase}".`;
}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const tooLong = (s: string) => s.length > MAX_PHRASE;
type Routing = { channels: string[] | "all"; level: RuleLevel };

function parseBanned(i: Record<string, unknown>, { channels, level }: Routing): NewRule | string {
  const phrase = str(i.phrase);
  if (!phrase) return "Write the words a draft must not use.";
  if (tooLong(phrase)) return `Keep the words under ${MAX_PHRASE} characters.`;
  const where = i.where === "start" || i.where === "end" ? i.where : undefined;
  return { kind: "banned", phrases: [phrase], channels, level, text: bannedText(phrase, where), ...(where ? { where } : {}) };
}

function parseReplace(i: Record<string, unknown>, { channels, level }: Routing): NewRule | string {
  const from = str(i.from);
  const to = str(i.to);
  if (!from || !to) return "Write both the word to avoid and the word to use.";
  if (tooLong(from) || tooLong(to)) return `Keep each word under ${MAX_PHRASE} characters.`;
  if (from.toLowerCase() === to.toLowerCase()) return "The two words are the same.";
  return { kind: "replace", from, to, channels, level, text: `Say "${to}", never "${from}".` };
}

function parseEndsWith(i: Record<string, unknown>, { channels, level }: Routing): NewRule | string {
  const phrase = str(i.phrase);
  if (!phrase) return "Write the ending every draft needs.";
  if (tooLong(phrase)) return `Keep the ending under ${MAX_PHRASE} characters.`;
  return { kind: "ends_with", phrase, channels, level, text: `End with "${phrase}"` };
}

function parseGuidance(i: Record<string, unknown>, { channels, level }: Routing): NewRule | string {
  const text = str(i.text);
  if (!text) return "Write the rule in your own words.";
  if (text.length > MAX_TEXT) return `Keep the rule under ${MAX_TEXT} characters.`;
  return { kind: "guidance", channels, level, text };
}

function parseRuleBody(input: unknown): NewRule | string {
  if (!input || !isObject(input)) return "Fill in the rule.";
  const i = input;
  const channels = parseChannels(i.channels);
  if (!channels || (channels !== "all" && (channels.length === 0 || channels.some((c) => !(c in NETWORKS))))) return "Pick every network, or the networks this rule is for.";
  const routing: Routing = { channels, level: i.level === "warn" ? "warn" : "block" };
  switch (i.kind) {
    case "banned": return parseBanned(i, routing);
    case "replace": return parseReplace(i, routing);
    case "ends_with": return parseEndsWith(i, routing);
    case "guidance": return parseGuidance(i, routing);
    default:
      return "Pick what kind of rule this is.";
  }
}
