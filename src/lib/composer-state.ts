/**
 * @fileoverview Everything the composer shows that follows from what the person has done: which places are on, the
 * Discord channel, the picked moment, what stops the send, and the button's words. Pure, so the component only holds
 * state and draws.
 */
import type { PostTargets } from "@/app/(app)/direct-post-actions";
import { sendLabel, textOf, textProblem, type ComposerPlace } from "./composer-places";
import { atLocal, repeatedOffset, when } from "./post-time";

/** What opening the composer loaded: where it can post, which places start on, and when it opened (ms). */
export type ComposerLoad = { targets: PostTargets; places: ComposerPlace[]; startOn: Record<string, boolean>; now: number };

/** The person's choices so far. */
export type ComposerChoices = {
  toggled: Readonly<Record<string, boolean>>;
  own: Readonly<Record<string, string>>;
  shared: string;
  channelPick: string | null;
  scheduled: boolean;
  day: Date | undefined;
  time: string;
};

export type ComposerState = {
  chosen: ComposerPlace[];
  channelId: string | null;
  channelName: string | null;
  at: Date | null;
  whenText: string | null;
  problems: string[];
  label: string;
};

/** What stops the picked time: no day yet, a skipped clock time, or a time already past. Null when it is fine. */
export function timeProblem(c: Pick<ComposerChoices, "scheduled" | "day" | "time">, at: Date | null, now: number): string | null {
  if (!c.scheduled) return null;
  if (!c.day) return "Pick a day.";
  if (!at) return `${c.time} does not exist that day: the clocks move forward. Pick another time.`;
  return at.getTime() <= now + 30_000 ? "Pick a time in the future." : null;
}

/** The moment picked, with its UTC offset added when that time happens twice that day. */
function picked(c: ComposerChoices): { at: Date | null; whenText: string | null } {
  const at = c.scheduled && c.day ? atLocal(c.day, c.time) : null;
  if (!at) return { at: null, whenText: null };
  const offset = repeatedOffset(at);
  return { at, whenText: offset ? `${when(at.toISOString())} (${offset})` : when(at.toISOString()) };
}

/** What the composer shows for this load and these choices; with nothing loaded yet, nothing is chosen. */
export function composerState(load: ComposerLoad | null, c: ComposerChoices): ComposerState {
  const chosen = (load?.places ?? []).filter((p) => c.toggled[p.key] ?? load?.startOn[p.key] ?? false);
  const discord = load?.targets.discord ?? null;
  const channelId = c.channelPick ?? discord?.defaultId ?? null;
  const channelName = discord?.channels.find((ch) => ch.id === channelId)?.name ?? null;
  const { at, whenText } = picked(c);
  const problems = [
    ...chosen.map((p) => textProblem(p, textOf(p.key, c.own, c.shared))),
    chosen.some((p) => p.kind === "discord") && channelName === null ? "Pick a Discord channel Queue Pilot can post in." : null,
    timeProblem(c, at, load?.now ?? 0),
  ].filter((p): p is string => p !== null);
  const names = chosen.map((p) => (p.kind === "discord" && channelName ? `#${channelName}` : p.label));
  return { chosen, channelId, channelName, at, whenText, problems, label: sendLabel(names, whenText, c.scheduled) };
}
