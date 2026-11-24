/**
 * @fileoverview The places one composed post can go to, as one list: each connected Mastodon or Bluesky account and the
 * deployment's Telegram and Discord bots. A place's key is the one the server reads for its own text ("telegram",
 * "discord", or "mastodon|<account id>"), so the composer keeps one map of per-place text and never translates keys.
 */
import type { PostTargets } from "@/app/(app)/direct-post-actions";
import { countFor } from "./char-limits";
import type { PostKind } from "./direct-posts";

/** One place in the composer. accountId is set for a person's own account, null for a bot. */
export type ComposerPlace = { key: string; kind: PostKind; label: string; limit: number; accountId: string | null };

/** Every place these targets offer: accounts first, then the bots. */
export function composerPlaces(targets: PostTargets): ComposerPlace[] {
  const accounts = (targets.accounts ?? []).map((a): ComposerPlace => ({ key: `${a.network}|${a.id}`, kind: a.network, label: a.label, limit: a.limit, accountId: a.id }));
  const bots: ComposerPlace[] = [];
  if (targets.telegram) bots.push({ key: "telegram", kind: "telegram", label: targets.telegram.label, limit: targets.telegram.limit, accountId: null });
  if (targets.discord) bots.push({ key: "discord", kind: "discord", label: targets.discord.label, limit: targets.discord.limit, accountId: null });
  return [...accounts, ...bots];
}

/**
 * Which places start switched on: all of them, or only one account when the composer opened from that account's
 * empty time in Next week.
 */
export function placesOnAtStart(places: ComposerPlace[], onlyAccountId?: string): Record<string, boolean> {
  return Object.fromEntries(places.map((p) => [p.key, onlyAccountId === undefined || p.accountId === onlyAccountId]));
}

/** The text a place gets: its own text when the person wrote one, else the shared text. Trimmed. */
export const textOf = (key: string, own: Readonly<Record<string, string>>, shared: string): string => (own[key] ?? shared).trim();

/** What stops this place's text from going out, in plain words; null when it can go. */
export function textProblem(place: ComposerPlace, text: string): string | null {
  if (!text) return `Write the text for ${place.label}.`;
  const over = countFor(place.kind, text) - place.limit;
  return over > 0 ? `The text for ${place.label} is ${over} characters too long.` : null;
}

/** The send button's words for the chosen place names and the picked time. */
export function sendLabel(names: readonly string[], whenText: string | null, scheduled: boolean): string {
  if (names.length === 0) return "Choose a place";
  if (whenText) return `Schedule for ${whenText}`;
  if (scheduled) return "Schedule";
  return names.length > 1 ? `Send to ${names.length} places` : `Send to ${names[0]}`;
}
