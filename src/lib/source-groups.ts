/**
 * @fileoverview Groups a draft's source evidence by source for the draft window: evidence is stored per claim, so the
 * same source would otherwise repeat once per sentence.
 */
import type { EvidenceCard } from "./source-presentation";

/** What to do after editing a draft whose quotes were checked against the old words. Kept here, with no server imports, so the draft window can show it. */
export const EDITED_DRAFT_LINE = "You edited this draft. Check it again before approving.";

/** One source and the quotes a draft takes from it. */
export type SourceGroup = {
  key: string;
  title: string;
  uri: string;
  /** Quotes in the order their claims appear in the post. */
  quotes: EvidenceCard[];
  /** How many of them were found word for word in the saved source. */
  found: number;
};

/** Where a claim starts in the post, ignoring case and spacing; a claim the post no longer contains sorts last. */
function placeInPost(c: EvidenceCard): number {
  const flat = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  const at = flat(c.draftText).indexOf(flat(c.claim));
  return c.claim.trim() && at >= 0 ? at : Number.POSITIVE_INFINITY;
}

/**
 * Groups evidence cards by source (its key, or its link when it has none). Quotes, and the sources holding them, follow
 * the order of the sentences in the post, so the window reads top to bottom like the post. Evidence is saved per claim
 * in whatever order the writer produced it, which is not that order.
 *
 * @param cards - One draft's evidence cards
 * @returns One group per source
 */
export function groupBySource(cards: EvidenceCard[]): SourceGroup[] {
  const groups = new Map<string, SourceGroup>();
  // Array sort is stable, so claims at the same place (or missing from the post) keep their saved order.
  const ordered = [...cards].sort((a, b) => placeInPost(a) - placeInPost(b) || 0);
  for (const c of ordered) {
    const key = c.sourceKey ?? c.uri;
    const g = groups.get(key) ?? { key, title: c.title, uri: c.uri, quotes: [], found: 0 };
    g.quotes.push(c);
    if (c.quote) g.found += 1;
    groups.set(key, g);
  }
  return [...groups.values()];
}

/**
 * Real problems with a quote: its words are missing from the source, the source changed, or a check found the draft no
 * longer matches it. An edited draft that only waits for a fresh check is not a problem with any one quote; the draft
 * window says that once, above its sources.
 */
export function quoteProblems(c: EvidenceCard): string[] {
  return [
    !c.quote && "Quote not found in the saved source",
    c.changed && "The source changed after this draft was written",
    c.needsCheck && !c.changed && !c.edited && "Check this draft against the current source",
  ].filter((x): x is string => Boolean(x));
}

/** Notes about how a quote was read, worth knowing but not a fault: part of the source, a description, captions. */
export function quoteNotes(c: EvidenceCard): string[] {
  return [
    c.truncated && "Only part of the source was read",
    c.kind === "video-description" && "Video description only",
    c.captions === "auto" && "Auto captions: check names",
    c.captions === "unknown" && "Caption type unknown: check names",
    c.paidPreview && "Paid preview only",
  ].filter((x): x is string => Boolean(x));
}

/**
 * Every warning about a quote, in plain words, problems first: one list decides both what the draft window shows and
 * which quotes stay open, so a warning can never sit inside a folded quote.
 */
export function quoteWarnings(c: EvidenceCard): string[] {
  return [...quoteProblems(c), ...quoteNotes(c)];
}

/** Whether a quote has any warning, so it must stay open. */
export function quoteNeedsAttention(c: EvidenceCard): boolean {
  return quoteWarnings(c).length > 0;
}
