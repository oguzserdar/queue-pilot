/**
 * The one way drafts reach a person's Buffer queue, shared by the connector's save_drafts tool and the web app's
 * "Write drafts" button. Order: judge the drafts against the playbook with a model (judge.ts), refuse those that
 * break a "do not save" rule, save the rest as Buffer drafts (save-drafts.ts, platform checks only), then record what
 * was written with its verdicts. Bookkeeping after Buffer accepted the drafts never turns into an error, so a caller
 * does not retry a save that already happened.
 */
import { withSavedDrafts } from "./buffer/snapshot";
import { postgresSnapshotStore } from "./buffer/snapshot-store";
import { judgeDrafts, type JudgeInput, type Verdict } from "./judge";
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
  if (rules === null) return { ...none, check: "no-playbook" };
  if (!rules.length) return { ...none, check: "no-rules" };
  // Out of AI actions with a "do not save" rule in the playbook: refuse rather than save drafts nobody checked.
  if (!judge && cappedReason && rules.some((r) => r.level === "block"))
    return { keep: [], refused: drafts.map((d) => ({ slotId: d.slotId, reason: cappedReason })), verdicts: new Map(), check: "no-model" };
  if (!judge) return { ...none, check: "no-model" };
  const service = new Map(open.map((s) => [s.id, s.service]));
  let verdicts: Map<string, Verdict[]>;
  try {
    verdicts = await judge(drafts.map((d) => ({ slotId: d.slotId, text: d.text, network: service.get(d.slotId) ?? "" })), rules);
  } catch (e) {
    console.warn(JSON.stringify({ event: "qp-judge-failed", message: e instanceof Error ? e.message : String(e) }));
    return { ...none, check: "failed" };
  }
  const keep: DraftInput[] = [];
  const refused: RefusedDraft[] = [];
  for (const d of drafts) {
    const block = (verdicts.get(d.slotId) ?? []).filter((v) => v.verdict === "fail" && v.level === "block");
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
  input: { title: string; drafts: DraftInput[]; open: OpenSlot[]; sourceKeys?: string[] },
  /** The AI an enclosing action already took; the check then judges with it instead of taking another action. */
  within?: JudgeModel,
): Promise<SaveResult & { flags: Flag[]; check: PlaybookCheck; judgedWith?: string }> {
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
    const filled = res.saved.map((x) => parseSlotId(x.slotId)).filter((x): x is { channelId: string; at: string } => x !== null);
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
      .map((x) => ({ postId: x.postId, network: x.network, text: x.text, verdicts: gate.check === "judged" ? (gate.verdicts.get(x.slotId) ?? []) : null }));
    await postgresWrittenStore().record(userId, wrote).catch(warn("qp-record-written-failed"));
    if (input.sourceKeys?.length) await postgresSourceStore().markUsed(userId, input.sourceKeys).catch(warn("qp-mark-used-failed"));
  }
  return { saved: res.saved, refused: [...gate.refused, ...res.refused], requests: res.requests, flags: flagsFor(res.saved, gate.verdicts), check: gate.check, judgedWith: jm?.source };
}

/** What to tell the person about how their playbook was applied; undefined when it was judged or there are no rules. */
export function checkNote(check: PlaybookCheck): string | undefined {
  if (check === "no-model") return "Not checked against your playbook: add your AI key in Settings so a model can judge each draft.";
  if (check === "failed") return "Not checked against your playbook: the check could not run just now.";
  if (check === "no-playbook") return "Not checked against your playbook: it could not be read just now.";
  return undefined;
}

/**
 * The playbook check for one changed draft (update_draft), so a draft cannot be saved clean and then edited past a
 * "do not save" rule. Returns the refusal reason, or null when the text may be saved, with how it was checked.
 */
export async function judgeEdit(userId: string, text: string, network: string): Promise<{ refusal: string | null; check: PlaybookCheck }> {
  const rules = await postgresRulesStore().list(userId).catch(() => null);
  const { jm, cappedReason } = rules?.length ? await judgeFor(userId) : { jm: null, cappedReason: null };
  const slot = { id: "edit", service: network } as OpenSlot;
  const gate = await applyPlaybook([{ slotId: "edit", text }], [slot], rules, jm ? (d, r) => judgeDrafts(jm.judges, d, r) : null, cappedReason).finally(() => jm?.settle());
  return { refusal: gate.refused[0]?.reason ?? null, check: gate.check };
}
