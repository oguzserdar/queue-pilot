/**
 * @fileoverview The part of a draft a person changed, cut down to a readable line for the same-fix offer. A whole
 * LinkedIn draft is too long to show twice, so the offer shows the changed words with a few words around them.
 */

/** Words kept on each side of the change. */
const CONTEXT_WORDS = 5;

/**
 * One edit trimmed to the changed words plus a little context, with "…" where text was cut. `before` and `after` are
 * the two whole excerpts; `lead`, `removed`, `added` and `tail` are the same line split so the change can be marked.
 */
export type FixExcerpt = { before: string; after: string; lead: string; removed: string; added: string; tail: string };

/**
 * Trims an edit to the stretch that changed. The words both versions share at the start and at the end are cut,
 * keeping {@link CONTEXT_WORDS} of them on each side so the change still reads as a sentence.
 *
 * @param before - What Queue Pilot wrote
 * @param after - What the person left in Buffer
 * @returns Both versions, trimmed the same way
 */
export function fixExcerpt(before: string, after: string): FixExcerpt {
  const a = before.trim().split(/\s+/).filter(Boolean);
  const b = after.trim().split(/\s+/).filter(Boolean);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let end = 0;
  while (end < a.length - start && end < b.length - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end++;
  const from = Math.max(0, start - CONTEXT_WORDS);
  const keepEnd = Math.min(end, CONTEXT_WORDS);
  const cut = (ws: string[]) => {
    const to = ws.length - end + keepEnd;
    return `${from > 0 ? "…" : ""}${ws.slice(from, to).join(" ")}${to < ws.length ? "…" : ""}`;
  };
  const lead = `${from > 0 ? "…" : ""}${a.slice(from, start).join(" ")}`;
  const tailWords = a.slice(a.length - end, a.length - end + keepEnd);
  const tail = `${tailWords.join(" ")}${a.length - end + keepEnd < a.length ? "…" : ""}`;
  return { before: cut(a), after: cut(b), lead, removed: a.slice(start, a.length - end).join(" "), added: b.slice(start, b.length - end).join(" "), tail };
}
