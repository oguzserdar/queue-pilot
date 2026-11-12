/**
 * Whether a draft Queue Pilot wrote may be approved now, from its last playbook check. One answer for every place
 * that approves (the app's buttons, Needs you, and approve_drafts), so none of them can skip the playbook.
 *
 * - ok: checked against the current rules and text, nothing failed.
 * - flagged: a warning rule failed or was unsure. It can go out; the person sees why.
 * - check: no current check (the text or the rules changed, or it was never checked: approving needs a fresh check),
 *   or a blocking rule could not be decided (a complete passing check is required).
 * - breaks: a blocking rule failed.
 */
import { playbookVersion } from "./playbook-version";
import { appliesTo, type Rule } from "./rules";
import { checkedTextOf } from "./checked-text";
import type { Written } from "./written-store";

/** `stale` marks evidence that needs a fresh check before approval. */
export type Readiness = { state: "ok" | "flagged" | "check" | "breaks"; reason?: string; stale?: boolean };

export function draftReadiness(written: Written | undefined, currentText: string, rules: Rule[], target?: { network: string; channelId?: string }): Readiness {
  const applicable = rules.filter(r => appliesTo(r, target?.network ?? written?.network ?? "", target?.channelId));
  if (!applicable.length) return { state: "ok" };
  const mandatory = applicable.filter(r => r.level === "block");
  const needsCheck = (reason: string): Readiness => ({ state: "check", stale: true, reason });
  if (!written || checkedTextOf(written) !== currentText || written.playbookRevision !== playbookVersion(rules) || !written.verdicts)
    return mandatory.length
      ? needsCheck("The draft or its rules changed. Check it again before approving.")
      : { state: "flagged", reason: "Not checked against the current rules." };
  // The current rule supplies its severity; old or incomplete verdicts cannot weaken a blocking rule.
  for (const rule of mandatory) {
    const answers = written.verdicts.filter(v => v.ruleId === rule.id);
    if (answers.length !== 1 || answers[0].unavailable)
      return needsCheck(`The check for "${rule.text}" is incomplete. Check again before approving.`);
    const answer = answers[0];
    if (answer.verdict === "fail") return { state: "breaks", reason: `It breaks "${rule.text}".${answer.reason ? ` ${answer.reason}` : ""}` };
    if (answer.verdict !== "pass") return needsCheck(`"${rule.text}" could not be decided. Check again before approving.`);
  }
  for (const rule of applicable.filter(r => r.level === "warn")) {
    const answer = written.verdicts.find(v => v.ruleId === rule.id);
    if (!answer || answer.verdict !== "pass" || answer.unavailable)
      return { state: "flagged", reason: `Flagged: "${rule.text}"${answer?.reason ? `. ${answer.reason}` : ""}` };
  }
  return { state: "ok" };
}

/** Only drafts whose last check lets them go out; the rest come back with the reason. */
export function approvable(ids: string[], written: Written[], posts: { id: string; text: string; channelId?: string; network?: string }[], rules: Rule[]): { allowed: string[]; refused: { id: string; reason: string }[] } {
  const byId = new Map(written.map((w) => [w.postId, w]));
  const current = new Map(posts.map((p) => [p.id, p]));
  const allowed: string[] = [];
  const refused: { id: string; reason: string }[] = [];
  for (const id of ids) {
    // Drafts Queue Pilot did not write, or that left the queue, are refused later with their own reason.
    if (!byId.has(id) || !current.has(id)) { allowed.push(id); continue; }
    const post = current.get(id)!;
    const r = draftReadiness(byId.get(id), post.text, rules, { network: post.network ?? byId.get(id)!.network, channelId: post.channelId });
    if (r.state === "breaks" || r.state === "check") refused.push({ id, reason: r.reason! });
    else allowed.push(id);
  }
  return { allowed, refused };
}
