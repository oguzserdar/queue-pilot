/**
 * Whether a draft Queue Pilot wrote may be approved now, from its last playbook check. One answer for every place
 * that approves (the app's buttons, Needs you, and approve_drafts), so none of them can skip the playbook.
 *
 * - ok: checked against the current rules and text, nothing failed.
 * - flagged: a warning rule failed or was unsure. It can go out; the person sees why.
 * - check: no current check (the text or the rules changed, or it was never checked: approving needs a fresh check),
 *   or a blocking rule could not be decided (the person reads it and decides).
 * - breaks: a blocking rule failed.
 */
import type { Verdict } from "./judge";
import { playbookVersion } from "./playbook-version";
import type { Rule } from "./rules";
import type { Written } from "./written-store";

/** `stale` marks a check that no longer matches the draft or the rules; approving needs a fresh one. */
export type Readiness = { state: "ok" | "flagged" | "check" | "breaks"; reason?: string; stale?: boolean };

export function draftReadiness(written: Written | undefined, currentText: string, rules: Rule[]): Readiness {
  if (!rules.length) return { state: "ok" };
  if (!written || written.text !== currentText || written.playbookRevision !== playbookVersion(rules) || !written.verdicts)
    // Only a blocking rule makes a fresh check mandatory; with warning rules alone the draft can go out, flagged.
    return rules.some((r) => r.level === "block")
      ? { state: "check", stale: true, reason: "The draft or your rules changed since it was checked. Check it again before approving." }
      : { state: "flagged", reason: "Not checked against your current rules." };
  const verdicts: Verdict[] = written.verdicts;
  const blockFail = verdicts.find((v) => v.level === "block" && v.verdict === "fail");
  if (blockFail) return { state: "breaks", reason: `It breaks "${blockFail.rule}".${blockFail.reason ? ` ${blockFail.reason}` : ""}` };
  const blockOpen = verdicts.find((v) => v.level === "block" && (v.verdict === "unsure" || v.unavailable));
  if (blockOpen) return { state: "check", reason: `"${blockOpen.rule}" could not be decided. Read it before approving.` };
  const warn = verdicts.find((v) => v.verdict !== "pass");
  if (warn) return { state: "flagged", reason: `Flagged: "${warn.rule}"${warn.reason ? `. ${warn.reason}` : ""}` };
  return { state: "ok" };
}

/** Only drafts whose last check lets them go out; the rest come back with the reason. */
export function approvable(ids: string[], written: Written[], posts: { id: string; text: string }[], rules: Rule[]): { allowed: string[]; refused: { id: string; reason: string }[] } {
  const byId = new Map(written.map((w) => [w.postId, w]));
  const text = new Map(posts.map((p) => [p.id, p.text]));
  const allowed: string[] = [];
  const refused: { id: string; reason: string }[] = [];
  for (const id of ids) {
    // Drafts Queue Pilot did not write, or that left the queue, are refused later with their own reason.
    if (!byId.has(id) || !text.has(id)) { allowed.push(id); continue; }
    const r = draftReadiness(byId.get(id), text.get(id)!, rules);
    if (r.state === "breaks" || r.stale) refused.push({ id, reason: r.reason! });
    else allowed.push(id);
  }
  return { allowed, refused };
}
