/**
 * The one way drafts reach a person's Buffer queue, shared by the connector's save_drafts tool and the web app's
 * "Write drafts" button. Order: judge the drafts against the playbook with a model (judge.ts), refuse those that
 * break a "do not save" rule, save the rest as Buffer drafts (save-drafts.ts, platform checks only), then record what
 * was written with its verdicts. Bookkeeping after Buffer accepted the drafts never turns into an error, so a caller
 * does not retry a save that already happened.
 */
import type { WrittenDraft } from "./ai-writer";
import { recordEvidence, sourceById } from "./source-store";
import { resolveSource } from "./resolve-source";
import { verifyEvidence } from "./source-evidence";
import { playbookVersion } from "./playbook-version";
import { withSavedDrafts } from "./buffer/snapshot";
import { postgresSnapshotStore } from "./buffer/snapshot-store";
import { judgeDrafts, rulesFor, type JudgeInput, type Verdict } from "./judge";
import { AiCapError, judgeModelFor, type JudgeModel } from "./judge-model";
import { parseSlotId, type OpenSlot } from "./open-slots";
import type { Rule } from "./rules";
import { postgresRulesStore } from "./rules-store";
import { saveDrafts, type DraftInput, type RefusedDraft, type SaveResult } from "./save-drafts";
import { postgresSourceStore } from "./sources-store";
import { postgresWrittenStore } from "./written-store";

export const PLAYBOOK_REFUSAL = "Breaks your playbook";

/** How the playbook was applied: judged; no rules to apply; no model to judge with; or the judge call failed. */
export type PlaybookCheck = "judged" | "no-rules" | "no-model" | "failed" | "no-playbook";

/** A saved draft the person should look at: a "flag it" rule it breaks, or a rule the model was unsure about. */
export type Flag = { slotId: string; rule: string; verdict: "fail" | "unsure"; reason: string; quote: string };

export type Judge = (drafts: JudgeInput[], rules: Rule[]) => Promise<Map<string, Verdict[]>>;

/** Splits drafts by the playbook: refused (a "do not save" rule fails), and the rest with their verdicts. */
export async function applyPlaybook(
  drafts: DraftInput[],
  open: OpenSlot[],
  rules: Rule[] | null,
  judge: Judge | null,
  /** Why no model could judge, when the reason is the daily AI cap rather than a missing key. */
  cappedReason: string | null = null,
): Promise<{ keep: DraftInput[]; refused: RefusedDraft[]; verdicts: Map<string, Verdict[]>; check: PlaybookCheck }> {
  const none = { keep: drafts, refused: [], verdicts: new Map<string, Verdict[]>() };
  if (rules === null) return { ...none, keep: [], refused: drafts.map((d) => ({ slotId: d.slotId, reason: "Not saved: your playbook could not be read. Try again." })), check: "no-playbook" };
  if (!rules.length) return { ...none, check: "no-rules" };
  const service = new Map(open.map((s) => [s.id, s.service]));
  const accounts = new Map(open.map((s) => [s.id, s.channelId]));
  const applicable = (d: DraftInput) => rulesFor(rules, service.get(d.slotId) ?? "", accounts.get(d.slotId));
  const unchecked = (check: "no-model" | "failed") => ({
    ...none,
    keep: drafts.filter((d) => !applicable(d).some((r) => r.level === "block")),
    refused: drafts.filter((d) => applicable(d).some((r) => r.level === "block")).map((d) => ({ slotId: d.slotId, reason: cappedReason ?? 'Not saved: your "do not save" rules could not be checked. Try again when AI is available.' })),
    check,
  });
  if (!judge) return unchecked("no-model");
  let verdicts: Map<string, Verdict[]>;
  try {
    verdicts = await judge(drafts.map((d) => ({ slotId: d.slotId, text: d.text, network: service.get(d.slotId) ?? "", channelId: accounts.get(d.slotId) })), rules);
  } catch (e) {
    console.warn(JSON.stringify({ event: "qp-judge-failed", message: e instanceof Error ? e.message : String(e) }));
    return unchecked("failed");
  }
  const keep: DraftInput[] = [];
  const refused: RefusedDraft[] = [];
  for (const d of drafts) {
    const answers = applicable(d).map((r) => (verdicts.get(d.slotId) ?? []).find((v) => v.ruleId === r.id) ?? {
      ruleId: r.id, rule: r.text, level: r.level, verdict: "unsure" as const, probability: null, quote: "", reason: "The check gave no answer for this rule.", unavailable: true,
    });
    verdicts.set(d.slotId, answers);
    const missing = answers.filter((v) => v.unavailable && v.level === "block");
    if (missing.length) {
      refused.push({ slotId: d.slotId, reason: `Not saved: the check gave no answer for ${missing.map((v) => `"${v.rule}"`).join(", ")}. Try again.` });
      continue;
    }
    const block = answers.filter((v) => v.verdict === "fail" && v.level === "block");
    if (block.length) refused.push({ slotId: d.slotId, reason: `${PLAYBOOK_REFUSAL}: ${block.map((v) => `"${v.rule}" (found "${v.quote}"). ${v.reason}`).join(" ")}` });
    else keep.push(d);
  }
  return { keep, refused, verdicts, check: "judged" };
}

/**
 * The judge for this person's playbook check. A missing key gives no judge; a used-up daily allowance also gives no
 * judge but keeps the reason, so "do not save" rules refuse the draft instead of being skipped.
 */
async function judgeFor(userId: string) {
  try {
    return { jm: await judgeModelFor(userId), cappedReason: null };
  } catch (e) {
    const capped = e instanceof AiCapError ? `Not saved: your "do not save" rules could not be checked. ${e.message}` : null;
    return { jm: null, cappedReason: capped };
  }
}

/** Flags for saved drafts: "flag it" rules that fail and any rule the model was unsure about. */
export const flagsFor = (saved: { slotId: string }[], verdicts: Map<string, Verdict[]>): Flag[] =>
  saved.flatMap((s) => (verdicts.get(s.slotId) ?? []).filter((v) => v.verdict !== "pass").map((v) => ({ slotId: s.slotId, rule: v.rule, verdict: v.verdict as "fail" | "unsure", reason: v.reason, quote: v.quote })));

const warn = (event: string) => (e: unknown) => console.warn(JSON.stringify({ event, message: e instanceof Error ? e.message : String(e) }));

export async function saveDraftsForUser(
  userId: string,
  accessToken: string,
  input: { title: string; drafts: WrittenDraft[]; open: OpenSlot[]; sourceKeys?: string[] },
  /** The AI an enclosing action already took; the check then judges with it instead of taking another action. */
  within?: JudgeModel,
): Promise<SaveResult & { flags: Flag[]; check: PlaybookCheck; judgedWith?: string }> {
  const evidenceWarnings: Flag[] = [];
  const evidenceSources = new Map<string, string[]>();
  const unresolved = new Set<string>();
  const resolved = new Map<string, Awaited<ReturnType<typeof resolveSource>>>();
  for (const draft of input.drafts) {
    if (draft.snapshotId) {
      // An explicit foreign snapshot is never silently accepted.
      const snapshot = await sourceById(userId, draft.snapshotId);
      if (!snapshot) throw new Error("The source is not in this account.");
      evidenceSources.set(draft.slotId, [snapshot.id ?? draft.snapshotId]);
    } else {
      const keys = draft.sourceKey ? [draft.sourceKey] : input.sourceKeys ?? [];
      const ids: string[] = [];
      for (const key of keys) {
        if (!resolved.has(key)) resolved.set(key, await resolveSource(userId, key).catch(() => null));
        const snapshot = resolved.get(key);
        if (snapshot) ids.push(snapshot.id); else unresolved.add(draft.slotId);
      }
      evidenceSources.set(draft.slotId, [...new Set(ids)]);
      if (keys.length) evidenceWarnings.push({ slotId: draft.slotId, rule: "Source evidence", verdict: "unsure", reason: "Source citation needs review before approving. The draft can still be saved.", quote: "" });
    }
    for (const id of evidenceSources.get(draft.slotId) ?? []) {
      const snapshot = await sourceById(userId, id);
      if (!snapshot) { unresolved.add(draft.slotId); continue; }
      if (!draft.evidence?.length || !draft.snapshotId) evidenceWarnings.push({ slotId: draft.slotId, rule: "Source evidence", verdict: "unsure", reason: "No source quote supplied. Check evidence before approving.", quote: "" });
      for (const e of draft.evidence ?? []) {
        const checked = verifyEvidence(draft.text, snapshot.text, e, snapshot.metadata);
        if (!checked.quote) evidenceWarnings.push({ slotId: draft.slotId, rule: "Source evidence", verdict: "unsure", reason: "The claim or quote could not be matched. Check the citation before approving.", quote: "" });
      }
    }
  }
  const rules = await postgresRulesStore().list(userId).catch((e) => {
    console.error(JSON.stringify({ event: "qp-rules-read-failed", message: e instanceof Error ? e.message : String(e) }));
    return null;
  });
  const { jm, cappedReason } = !rules?.length ? { jm: null, cappedReason: null } : within ? { jm: within, cappedReason: null } : await judgeFor(userId);
  // Only drafts for real open slots are judged: the rest are refused by saveDrafts anyway, and judging them would spend
  // the AI budget on drafts that can never be saved.
  const open = new Set(input.open.map((o) => o.id));
  const known = input.drafts.filter((d) => open.has(d.slotId));
  const unknown = input.drafts.filter((d) => !open.has(d.slotId));
  const gate = await applyPlaybook(known, input.open, rules, jm ? (d, r) => judgeDrafts(jm.judges, d, r) : null, cappedReason).finally(() => (within ? undefined : jm?.settle()));
  const toSave = [...gate.keep, ...unknown];
  const res = toSave.length ? await saveDrafts(accessToken, { title: input.title, drafts: toSave, open: input.open }) : { saved: [], refused: [], requests: 0 };
  if (res.saved.length) {
    const filled = res.saved.flatMap((x) => {
      const slot = parseSlotId(x.slotId)
      return slot ? [{ ...slot, postId: x.postId, text: x.text }] : []
    })
    try {
      const store = postgresSnapshotStore();
      const latest = await store.get(userId);
      if (latest) await store.save(userId, withSavedDrafts(latest, filled));
    } catch (e) {
      warn("qp-snapshot-mark-drafts-failed")(e);
    }
    // What Queue Pilot wrote and how it was judged, so later edits can be read back and the week shows the verdicts.
    const wrote = res.saved
      .filter((x): x is typeof x & { postId: string } => x.postId !== null)
      .map((x) => ({ postId: x.postId, network: x.network, text: x.text, playbookRevision: rules ? playbookVersion(rules) : null, verdicts: gate.check === "judged" ? (gate.verdicts.get(x.slotId) ?? []) : null }));
    const missingEvidence = new Set<string>();
    for (const saved of res.saved) {
      const draft = input.drafts.find(d => d.slotId === saved.slotId);
      if (!saved.postId || !draft) continue;
      if (unresolved.has(saved.slotId)) missingEvidence.add(saved.postId);
      // Legacy batch source keys are ambiguous: record each as unchecked, never invent a citation.
      for (const snapshotId of evidenceSources.get(saved.slotId) ?? []) {
        const evidence = draft.snapshotId && draft.evidence?.length ? draft.evidence : [{ claim: draft.text.slice(0, 500), quote: "[No source quote supplied]" }];
        await recordEvidence(userId, saved.postId, saved.text, snapshotId, evidence).catch(() => {
          missingEvidence.add(saved.postId!);
          evidenceWarnings.push({ slotId: saved.slotId, rule: "Source evidence", verdict: "unsure", reason: "Draft saved, but its evidence could not be recorded. Do not retry saving the draft.", quote: "" });
        });
      }
    }
    // If evidence bookkeeping failed, do not create an ownership record that would allow QP approval.
    await postgresWrittenStore().record(userId, wrote.filter(w => !missingEvidence.has(w.postId))).catch(warn("qp-record-written-failed"));
    if (input.sourceKeys?.length) await postgresSourceStore().markUsed(userId, input.sourceKeys).catch(warn("qp-mark-used-failed"));
  }
  return { saved: res.saved, refused: [...gate.refused, ...res.refused], requests: res.requests, flags: [...flagsFor(res.saved, gate.verdicts), ...evidenceWarnings], check: gate.check, judgedWith: jm?.source };
}

/** What to tell the person about how their playbook was applied; undefined when it was judged or there are no rules. */
export function checkNote(check: PlaybookCheck): string | undefined {
  if (check === "no-model") return "Not checked against your playbook: AI is unavailable. Check the allowance or your own key in Settings. Drafts needing a mandatory check were not saved.";
  if (check === "failed") return "Not checked against your playbook: the check could not run just now.";
  if (check === "no-playbook") return "Not checked against your playbook: it could not be read just now.";
  return undefined;
}

/**
 * The playbook check for one changed draft (update_draft), so a draft cannot be saved clean and then edited past a
 * "do not save" rule. Returns the refusal reason, or null when the text may be saved, with how it was checked.
 */
export async function judgeEdit(userId: string, text: string, network: string, channelId?: string): Promise<{ refusal: string | null; check: PlaybookCheck }> {
  const rules = await postgresRulesStore().list(userId).catch(() => null);
  const { jm, cappedReason } = rules?.length ? await judgeFor(userId) : { jm: null, cappedReason: null };
  const slot = { id: "edit", service: network, channelId } as OpenSlot;
  const gate = await applyPlaybook([{ slotId: "edit", text }], [slot], rules, jm ? (d, r) => judgeDrafts(jm.judges, d, r) : null, cappedReason).finally(() => jm?.settle());
  return { refusal: gate.refused[0]?.reason ?? null, check: gate.check };
}

/**
 * Check again: judges drafts Queue Pilot wrote, as their text is now, against the current playbook, and records the
 * result so they can be approved. Returns a reason when no check could run (AI unavailable, playbook unreadable).
 */
export async function recheckDrafts(userId: string, drafts: { postId: string; text: string; network: string; channelId: string }[]): Promise<{ ok: true; checked: number } | { ok: false; message: string }> {
  if (!drafts.length) return { ok: true, checked: 0 };
  const rules = await postgresRulesStore().list(userId).catch(() => null);
  if (rules === null) return { ok: false, message: "Your playbook could not be read just now. Try again." };
  const { jm, cappedReason } = rules.length ? await judgeFor(userId) : { jm: null, cappedReason: null };
  if (rules.length && !jm) return { ok: false, message: cappedReason ?? "AI is unavailable. Check the allowance or your own key in Settings." };
  const slots = drafts.map((d) => ({ id: d.postId, service: d.network, channelId: d.channelId }) as OpenSlot);
  const gate = await applyPlaybook(drafts.map((d) => ({ slotId: d.postId, text: d.text })), slots, rules, jm ? (x, r) => judgeDrafts(jm.judges, x, r) : null, cappedReason).finally(() => jm?.settle());
  if (gate.check === "failed") return { ok: false, message: "The check could not run just now. Try again." };
  await postgresWrittenStore().record(userId, drafts.map((d) => ({ postId: d.postId, network: d.network, text: d.text, playbookRevision: playbookVersion(rules), verdicts: gate.check === "judged" ? (gate.verdicts.get(d.postId) ?? []) : [] })));
  return { ok: true, checked: drafts.length };
}
