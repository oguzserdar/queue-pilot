/**
 * @fileoverview Where a rule came from and who approved a draft, in the words the draft window and the connector show.
 *
 * Both read records Queue Pilot already keeps: a kept suggestion's evidence (`learnedFrom`), who added a rule
 * (`addedBy`), and the approver on a written draft. A rule with no record has no origin: never guess one.
 */

import { appWords, capAppName, type ConnectedApp } from "./app-identity";

/**
 * Who approved a draft: the person with the app's own button, or a connected AI app with whether its name was proven.
 * Stored tagged, so no app name can read as the in-app button.
 */
export type Approver = { via: "app" } | { via: "ai"; app: string; verified: boolean };

/** The approver Queue Pilot records when the person presses Approve in the app. Browser-safe: no database import here. */
export const APPROVED_IN_APP: Approver = Object.freeze({ via: "app" as const });

/** How rows written before approvers were tagged stored the in-app button. Read only, never written. */
const LEGACY_IN_APP = "queue-pilot";

/**
 * Who added a rule: the person in the app, a connected AI app by name, or Queue Pilot itself with the starting rule every
 * new account gets (src/lib/starting-rule.ts). Set only by the server.
 */
export type AddedBy = "you" | "starting" | { app: string; verified?: boolean };

/** The words the Playbook, the draft window and the connector show for the starting rule's origin. */
export const STARTING_RULE_ORIGIN = "Starting rule";

/**
 * Whether a rule is the starting rule Queue Pilot gave the account, rather than one of the person's own.
 *
 * @param rule - Any rule with its optional adder
 * @returns True only for the rule Queue Pilot seeded at account creation
 */
export function isStartingRule(rule: { addedBy?: AddedBy }): boolean {
  return rule.addedBy === "starting";
}

/**
 * The person's own rules: everything but the starting rule. "No rules yet" on the Playbook and in the connector means
 * this list is empty.
 *
 * @param rules - The playbook as stored
 * @returns The rules the person kept, added or had their AI add
 */
export function ownRules<R extends { addedBy?: AddedBy }>(rules: R[]): R[] {
  return rules.filter((r) => !isStartingRule(r));
}

/**
 * The approver record for a connected AI app.
 *
 * @param app - The app's shown name and whether its address proved it
 * @returns A tagged approver with the name capped
 */
export function approverFor(app: ConnectedApp): Approver {
  return { via: "ai", app: capAppName(app.name), verified: app.verified };
}

/**
 * The text kept in the approver column.
 *
 * @param approver - Who approved
 * @returns JSON of the tagged value
 */
export function serializeApprover(approver: Approver): string {
  return JSON.stringify(approver.via === "app" ? { via: "app" } : { via: "ai", app: capAppName(approver.app), verified: approver.verified });
}

/** Reads a stored approver: the tagged JSON form, or an older bare string. */
function parseApprover(stored: string): Approver | string {
  if (!stored.startsWith("{")) return stored;
  try {
    const v = JSON.parse(stored) as Record<string, unknown>;
    if (v.via === "app") return APPROVED_IN_APP;
    if (v.via === "ai" && typeof v.app === "string") return { via: "ai", app: v.app, verified: v.verified === true };
  } catch { /* Not a tagged value: an older bare name. */ }
  return stored;
}

const day = (iso: unknown) => {
  const t = typeof iso === "string" ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }) : null;
};
const times = (n: number) => (n === 2 ? "twice" : `${n} times`);

/**
 * Where a rule came from, from its stored record.
 *
 * @param rule - A rule with its optional kept evidence and adder
 * @returns "A note from Sam on 1 Nov", "Your edit, twice", "Added by you", "Added by your AI (Claude)", "Starting rule",
 *   or null when nothing was recorded
 */
export function ruleOrigin(rule: { learnedFrom?: unknown; addedBy?: AddedBy }): string | null {
  const e = rule.learnedFrom;
  if (e && typeof e === "object" && !Array.isArray(e)) {
    const ev = e as Record<string, unknown>;
    if (ev.kind === "note") {
      const by = typeof ev.author === "string" && ev.author ? ev.author : typeof ev.by === "string" && ev.by ? ev.by : "a teammate";
      const on = day(ev.at);
      return `A note from ${by}${on ? ` on ${on}` : ""}`;
    }
    if (ev.kind === "review") return "A reviewer's comment";
    if (ev.kind === "posts") return "Your past posts";
    if (typeof ev.count === "number" && ev.count > 1) return `Your edit, ${times(ev.count)}`;
  }
  if (Array.isArray(e) && e.length) return "Your rewrites";
  if (rule.addedBy === "you") return "Added by you";
  if (rule.addedBy === "starting") return STARTING_RULE_ORIGIN;
  if (rule.addedBy && typeof rule.addedBy === "object" && typeof rule.addedBy.app === "string") {
    return rule.addedBy.verified === false ? `Added by ${appWords({ name: rule.addedBy.app, verified: false })}` : `Added by your AI (${rule.addedBy.app})`;
  }
  return null;
}

/**
 * The last approval Queue Pilot recorded for a draft, in words. It is history, not current authority: the record
 * survives the post going back to draft or being approved again in Buffer, which Queue Pilot cannot see.
 *
 * @param approvedBy - The recorded approver: a tagged Approver, its stored JSON, or an older bare string
 *   ("queue-pilot" for the in-app button, else an AI app's name)
 * @param approvedAt - When it was recorded, if known
 * @returns "Last approved through Queue Pilot: by you, 3 Nov", "… by Claude, 3 Nov" or "… by an
 *   unverified app named "x"", or null when no approval was recorded here
 */
export function approverLine(approvedBy: Approver | string | null | undefined, approvedAt?: string | null): string | null {
  if (!approvedBy) return null;
  const a = typeof approvedBy === "string" ? parseApprover(approvedBy) : approvedBy;
  const who = typeof a === "string"
    ? a === LEGACY_IN_APP ? "you" : a
    : a.via === "app" ? "you" : appWords({ name: a.app, verified: a.verified });
  const on = day(approvedAt);
  return `Last approved through Queue Pilot: by ${who}${on ? `, ${on}` : ""}`;
}
