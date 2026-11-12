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

/** Where a rule applies, in plain words: "every network", "every network except X", or the networks it names. */
export function ruleScope(rule: RuleRouting): string {
  if (rule.accountIds?.length) return `${rule.accountIds.length} selected account${rule.accountIds.length === 1 ? "" : "s"}`;
  if (rule.channels !== "all") return rule.channels.map((c) => NETWORKS[c] ?? c).join(", ");
  const off = (rule.except ?? []).map((c) => NETWORKS[c] ?? c);
  return off.length ? `every network except ${off.join(", ")}` : "every network";
}

/** What happens to a draft that breaks the rule, in the words the Playbook shows. */
export function ruleHold(rule: Rule): "Blocks drafts" | "Flags drafts" {
  return rule.level === "block" ? "Blocks drafts" : "Flags drafts";
}

const MAX_PHRASE = 120;
const MAX_TEXT = 200;

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

/**
 * Turns form or tool input into a rule, or a sentence saying what to fix. Input is never trusted: every field is
 * checked for type and length, and the networks must be ones Queue Pilot knows.
 */
export function parseNewRule(input: unknown): NewRule | string {
  let rule = parseRuleBody(input);
  if (typeof rule === "string") return rule;
  const overrides = (input as Record<string, unknown>).overrides;
  if (overrides !== undefined) {
    if (!overrides || typeof overrides !== "object" || Array.isArray(overrides)) return "Invalid rule exceptions.";
    const clean: NonNullable<RuleRouting["overrides"]> = {};
    for (const group of ["networks", "accounts"] as const) {
      const map = (overrides as Record<string, unknown>)[group];
      if (map === undefined) continue;
      if (!map || typeof map !== "object" || Array.isArray(map) || Object.keys(map).length > 50) return "Invalid rule exceptions.";
      const entries = Object.entries(map);
      if (entries.some(([key, value]) => !key || key.length > 200 || typeof value !== "boolean" || (group === "networks" && !Object.hasOwn(NETWORKS, key)))) return "Invalid rule exceptions.";
      clean[group] = Object.fromEntries(entries) as Record<string, boolean>;
    }
    rule = { ...rule, overrides: clean };
  }
  const ids = (input as Record<string, unknown>).accountIds;
  if (ids !== undefined) {
    if (!Array.isArray(ids) || !ids.length || ids.length > 30 || ids.some(id => typeof id !== "string" || !id || id.length > 200)) return "Choose valid accounts.";
    return { ...rule, channels: "all", accountIds: [...new Set(ids)] };
  }
  if (rule.channels !== "all") return rule;
  // A shared rule may come back with the networks it was switched off for (an undo, a restored rule).
  const raw = (input as Record<string, unknown>).except;
  const except = Array.isArray(raw) ? [...new Set(raw.filter((c): c is string => typeof c === "string" && c in NETWORKS))] : [];
  return except.length ? { ...rule, except } : rule;
}

function parseRuleBody(input: unknown): NewRule | string {
  if (!input || typeof input !== "object") return "Fill in the rule.";
  const i = input as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const channels = i.channels === "all" ? "all" : Array.isArray(i.channels) ? i.channels.filter((c): c is string => typeof c === "string") : null;
  if (!channels || (channels !== "all" && (channels.length === 0 || channels.some((c) => !(c in NETWORKS))))) return "Pick every network, or the networks this rule is for.";
  const level = i.level === "warn" ? "warn" : "block";
  const tooLong = (s: string) => s.length > MAX_PHRASE;
  switch (i.kind) {
    case "banned": {
      const phrase = str(i.phrase);
      if (!phrase) return "Write the words a draft must not use.";
      if (tooLong(phrase)) return `Keep the words under ${MAX_PHRASE} characters.`;
      const where = i.where === "start" || i.where === "end" ? i.where : undefined;
      const text = where === "start" ? `Never start with "${phrase}".` : where === "end" ? `Never end with "${phrase}".` : `Never "${phrase}".`;
      return { kind: "banned", phrases: [phrase], channels, level, text, ...(where ? { where } : {}) };
    }
    case "replace": {
      const from = str(i.from);
      const to = str(i.to);
      if (!from || !to) return "Write both the word to avoid and the word to use.";
      if (tooLong(from) || tooLong(to)) return `Keep each word under ${MAX_PHRASE} characters.`;
      if (from.toLowerCase() === to.toLowerCase()) return "The two words are the same.";
      return { kind: "replace", from, to, channels, level, text: `Say "${to}", never "${from}".` };
    }
    case "ends_with": {
      const phrase = str(i.phrase);
      if (!phrase) return "Write the ending every draft needs.";
      if (tooLong(phrase)) return `Keep the ending under ${MAX_PHRASE} characters.`;
      return { kind: "ends_with", phrase, channels, level, text: `End with "${phrase}"` };
    }
    case "guidance": {
      const text = str(i.text);
      if (!text) return "Write the rule in your own words.";
      if (text.length > MAX_TEXT) return `Keep the rule under ${MAX_TEXT} characters.`;
      return { kind: "guidance", channels, level, text };
    }
    default:
      return "Pick what kind of rule this is.";
  }
}
