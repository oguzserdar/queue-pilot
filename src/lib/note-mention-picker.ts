/**
 * @fileoverview The text rules behind the @mention picker in the draft window's notes: when typing "@" opens it, what
 * picking a teammate inserts, which teammates match what was typed, and which picked teammates are still named in the
 * text when the note is sent. Browser-safe: no Buffer calls here. Buffer itself places and checks each mention when the
 * note is saved (see placeMentions in buffer/notes.ts).
 */

/** A teammate the picker offers: someone who can read notes on the post's channel. */
export type NoteTeammate = {
  urn: string;
  /** The name written after "@": their Buffer name, or their email when they set none. */
  name: string;
  email: string;
  avatar: string | null;
  /** Buffer marks the member locked (viewer access on an organization with Roles); the picker shows but skips them. */
  locked: boolean;
};

/** A teammate picked into a note's text. */
export type PickedMention = { urn: string; name: string };

/** At most this many teammates show at once. */
export const MAX_SHOWN = 6;

/**
 * The "@query" being typed at the caret, when there is one: an "@" at the start of the text or after a space or
 * bracket (never inside an email address), on the same line, followed by at most two words.
 *
 * @param text - The field's text
 * @param caret - The caret position
 * @returns Where the "@" is and what follows it, or null when the picker should stay closed
 */
export function mentionQuery(text: string, caret: number): { start: number; query: string } | null {
  for (let i = caret - 1; i >= 0 && i >= caret - 48; i--) {
    const ch = text[i];
    if (ch === "\n") return null;
    if (ch !== "@") continue;
    if (i > 0 && !/[\s([{"']/.test(text[i - 1])) return null;
    const query = text.slice(i + 1, caret);
    return /^[^\s@]*( [^\s@]*)?$/.test(query) ? { start: i, query } : null;
  }
  return null;
}

/**
 * Replaces the typed "@query" with "@Name" and one space.
 *
 * @returns The new text and where the caret goes
 */
export function insertMention(text: string, start: number, caret: number, name: string): { text: string; caret: number } {
  const after = text.slice(caret);
  const gap = /^\s/.test(after) ? "" : " ";
  const token = `@${name}${gap}`;
  return { text: text.slice(0, start) + token + after, caret: start + token.length };
}

/**
 * The teammates that match what was typed after "@": name starts first, then a word in the name, then anywhere in the
 * name or email.
 *
 * @returns At most MAX_SHOWN teammates, best first
 */
export function matchTeammates(list: NoteTeammate[], query: string): NoteTeammate[] {
  const q = query.trim().toLowerCase();
  const score = (t: NoteTeammate) => {
    const name = t.name.toLowerCase();
    if (!q) return 1;
    if (name.startsWith(q)) return 4;
    if (name.split(/[\s\-_.]+/).some((w) => w.startsWith(q))) return 3;
    if (name.includes(q)) return 2;
    return t.email.toLowerCase().includes(q) ? 1 : 0;
  };
  return list.map((t) => ({ t, s: score(t) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, MAX_SHOWN).map((x) => x.t);
}

/** Whether "@name" appears in the text as a whole name (not the start of a longer one). */
function named(text: string, name: string): boolean {
  const span = `@${name}`;
  for (let at = text.indexOf(span); at >= 0; at = text.indexOf(span, at + 1)) if (!/[\p{L}\p{N}_]/u.test(text[at + span.length] ?? "")) return true;
  return false;
}

/**
 * The teammates to send with a note: each picked one whose "@Name" is still in the text, once. A name the person
 * deleted from the text is no longer a mention.
 *
 * @returns Their URNs, in picking order
 */
export function mentionsInText(text: string, picked: PickedMention[]): string[] {
  return [...new Set(picked.filter((p) => named(text, p.name)).map((p) => p.urn))];
}
