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
import { weekRange } from "./week-from-buffer";

export const MAX_SLOTS = 10;

type Saved = SaveResult & { flags: Flag[]; check: PlaybookCheck };

export type WriteWeekDeps = {
  material(): Promise<BriefMaterial[]>;
  voice(): Promise<Voice>;
  rules(): Promise<Rule[]>;
  write(brief: Brief): Promise<WrittenDraft[]>;
  save(drafts: WrittenDraft[], sourceKeys: string[]): Promise<Saved>;
};

export type WriteWeekResult =
  | { kind: "nothing"; reason: "no-slots" | "no-material" }
  | { kind: "done"; saved: SaveResult["saved"]; refused: SaveResult["refused"]; flags: Flag[]; retried: number; check: PlaybookCheck };

/**
 * The empty times one run writes into.
 *
 * Only times still ahead, inside the week shown (the week today is in, or the following one), at most MAX_SLOTS. When
 * the week has more empty times than that, they are taken one per day in turn, so every day gets a draft before any
 * day gets a second one; the result is returned soonest first. `only` asks for one exact time instead.
 *
 * @param week - "next" (the default) for the following Monday to Sunday, "this" for the week today is in
 */
export function slotsToWrite(open: OpenSlot[], now: Date, timeZone: string, only?: string, week: "this" | "next" = "next"): OpenSlot[] {
  const range = weekRange(now, timeZone, week === "this" ? 0 : 1);
  const soonest = (a: OpenSlot, b: OpenSlot) => a.at.localeCompare(b.at);
  const ahead = open.filter((s) => {
    const t = Date.parse(s.at);
    return t > now.getTime() && (only ? s.id === only : t >= range.start.getTime() && t < range.end.getTime());
  }).sort(soonest);
  if (ahead.length <= MAX_SLOTS) return ahead;
  const dayOf = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
  const days = new Map<string, OpenSlot[]>();
  for (const s of ahead) { const key = dayOf.format(new Date(s.at)); days.set(key, [...(days.get(key) ?? []), s]); }
  const picked: OpenSlot[] = [];
  for (let round = 0; picked.length < MAX_SLOTS; round++)
    for (const list of days.values()) if (list[round] && picked.length < MAX_SLOTS) picked.push(list[round]);
  return picked.sort(soonest);
}

const keysOf = (drafts: WrittenDraft[]) => [...new Set(drafts.flatMap((d) => (d.sourceKey ? [d.sourceKey] : [])))];

export async function writeWeek(open: OpenSlot[], now: Date, deps: WriteWeekDeps): Promise<WriteWeekResult> {
  // The caller selected the displayed week or one specific slot from the known Buffer range.
  const slots = open.filter((s) => Date.parse(s.at) > now.getTime()).sort((a, b) => a.at.localeCompare(b.at)).slice(0, MAX_SLOTS);
  if (!slots.length) return { kind: "nothing", reason: "no-slots" };
  const material = await deps.material();
  if (!material.length) return { kind: "nothing", reason: "no-material" };
  const [voice, rules] = await Promise.all([deps.voice(), deps.rules()]);
  const brief: Brief = { slots: slots.map((s) => ({ id: s.id, channelId: s.channelId, local: s.local, channel: s.channel, service: s.service })), material, voice: { note: voice.note, examples: voice.examples }, rules };

  const first = await deps.write(brief);
  const res = await deps.save(first, keysOf(first));
  const retry = Object.fromEntries(res.refused.filter((r) => r.reason.startsWith(PLAYBOOK_REFUSAL)).map((r) => [r.slotId, r.reason]));
  if (!Object.keys(retry).length) return { kind: "done", saved: res.saved, refused: res.refused, flags: res.flags, retried: 0, check: res.check };

  // One rewrite for the slots the playbook refused, with the reason in the brief.
  let second: WrittenDraft[];
  try { second = await deps.write({ ...brief, slots: brief.slots.filter((s) => s.id in retry), retry }); }
  catch {
    // Never turn an already successful Buffer save into a retryable whole-run error.
    return { kind: "done", saved: res.saved, refused: res.refused.map(r => r.slotId in retry ? { ...r, reason: `${r.reason} The rewrite could not run; saved drafts are unchanged.` } : r), flags: res.flags, retried: Object.keys(retry).length, check: res.check };
  }
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
