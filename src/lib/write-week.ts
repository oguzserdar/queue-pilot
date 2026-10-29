/**
 * "Write drafts with my AI": picks the empty slots of the coming week, has the person's AI write them, and saves
 * them through the same path as the connector (save-for-user.ts), where the playbook is judged. A draft the playbook
 * refuses gets one rewrite, told which rule it broke and why; whatever is refused after that is reported, never forced.
 */
import type { Brief, BriefMaterial, WrittenDraft } from "./ai-writer";
import type { OpenSlot } from "./open-slots";
import type { Rule } from "./rules";
import { PLAYBOOK_REFUSAL, type Flag, type PlaybookCheck } from "./save-for-user";
import type { SaveResult } from "./save-drafts";
import type { Voice } from "./voice-store";

export const MAX_SLOTS = 10;
const WEEK_MS = 7 * 24 * 3600 * 1000;

type Saved = SaveResult & { flags: Flag[]; check: PlaybookCheck };

export type WriteWeekDeps = {
  material(): Promise<BriefMaterial[]>;
  voice(): Promise<Voice>;
  rules(): Promise<Rule[]>;
  write(brief: Brief): Promise<WrittenDraft[]>;
  save(drafts: { slotId: string; text: string }[], sourceKeys: string[]): Promise<Saved>;
};

export type WriteWeekResult =
  | { kind: "nothing"; reason: "no-slots" | "no-material" }
  | { kind: "done"; saved: SaveResult["saved"]; refused: SaveResult["refused"]; flags: Flag[]; retried: number; check: PlaybookCheck };

/** The empty slots worth writing now: the next seven days, soonest first, at most MAX_SLOTS. */
export function slotsToWrite(open: OpenSlot[], now: Date): OpenSlot[] {
  const until = now.getTime() + WEEK_MS;
  return open.filter((s) => { const t = Date.parse(s.at); return t > now.getTime() && t <= until; }).sort((a, b) => a.at.localeCompare(b.at)).slice(0, MAX_SLOTS);
}

const keysOf = (drafts: WrittenDraft[]) => [...new Set(drafts.flatMap((d) => (d.sourceKey ? [d.sourceKey] : [])))];

export async function writeWeek(open: OpenSlot[], now: Date, deps: WriteWeekDeps): Promise<WriteWeekResult> {
  const slots = slotsToWrite(open, now);
  if (!slots.length) return { kind: "nothing", reason: "no-slots" };
  const material = await deps.material();
  if (!material.length) return { kind: "nothing", reason: "no-material" };
  const [voice, rules] = await Promise.all([deps.voice(), deps.rules()]);
  const brief: Brief = { slots: slots.map((s) => ({ id: s.id, local: s.local, channel: s.channel, service: s.service })), material, voice: { note: voice.note, examples: voice.examples }, rules };

  const first = await deps.write(brief);
  const res = await deps.save(first, keysOf(first));
  const retry = Object.fromEntries(res.refused.filter((r) => r.reason.startsWith(PLAYBOOK_REFUSAL)).map((r) => [r.slotId, r.reason]));
  if (!Object.keys(retry).length) return { kind: "done", saved: res.saved, refused: res.refused, flags: res.flags, retried: 0, check: res.check };

  // One rewrite for the slots the playbook refused, with the reason in the brief.
  const second = await deps.write({ ...brief, slots: brief.slots.filter((s) => s.id in retry), retry });
  const again: Saved = second.length ? await deps.save(second, keysOf(second)) : { saved: [], refused: [], requests: 0, flags: [], check: res.check };
  const missing = Object.keys(retry).filter((id) => !again.saved.some((x) => x.slotId === id) && !again.refused.some((x) => x.slotId === id));
  return {
    kind: "done",
    saved: [...res.saved, ...again.saved],
    refused: [...res.refused.filter((r) => !(r.slotId in retry)), ...again.refused, ...missing.map((slotId) => ({ slotId, reason: `The AI wrote no new draft. ${retry[slotId]}` }))],
    flags: [...res.flags, ...again.flags],
    retried: Object.keys(retry).length,
    check: again.check === "judged" ? res.check : again.check,
  };
}
