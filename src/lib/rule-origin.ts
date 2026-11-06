/**
 * @fileoverview Where a rule came from and who approved a draft, in the words the draft window and the connector show.
 *
 * Both read records Queue Pilot already keeps: a kept suggestion's evidence (`learnedFrom`), who added a rule
 * (`addedBy`), and the approver on a written draft. A rule with no record has no origin: never guess one.
 */

/** The approver Queue Pilot records when the person presses Approve in the app. Browser-safe: no database import here. */
export const APPROVED_IN_APP = "queue-pilot";

/** Who added a rule by hand: the person in the app, or a connected AI app by name. Set only by the server. */
export type AddedBy = "you" | { app: string };

const day = (iso: unknown) => {
  const t = typeof iso === "string" ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }) : null;
};
const times = (n: number) => (n === 2 ? "twice" : `${n} times`);

/**
 * Where a rule came from, from its stored record.
 *
 * @param rule - A rule with its optional kept evidence and adder
 * @returns "A note from Sam on 1 Nov", "Your edit, twice", "Added by you", "Added by your AI (Claude)", or null when
 *   nothing was recorded
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
  if (rule.addedBy && typeof rule.addedBy === "object" && typeof rule.addedBy.app === "string") return `Added by your AI (${rule.addedBy.app})`;
  return null;
}

/**
 * Who approved a draft for scheduling, in words.
 *
 * @param approvedBy - The recorded approver: APPROVED_IN_APP or an AI app's name
 * @returns "Approved by you in Queue Pilot" or "Approved through Claude", or null when not approved here
 */
export function approverLine(approvedBy: string | null | undefined): string | null {
  if (!approvedBy) return null;
  return approvedBy === APPROVED_IN_APP ? "Approved by you in Queue Pilot" : `Approved through ${approvedBy}`;
}
