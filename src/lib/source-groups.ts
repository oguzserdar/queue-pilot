/**
 * @fileoverview Groups a draft's source evidence by source for the draft window: evidence is stored per claim, so the
 * same source would otherwise repeat once per sentence.
 */
import type { EvidenceCard } from "./source-presentation";

/** One source and the quotes a draft takes from it. */
export type SourceGroup = {
  key: string;
  title: string;
  uri: string;
  /** Quotes in the order the draft's claims were saved. */
  quotes: EvidenceCard[];
  /** How many of them were found word for word in the saved source. */
  found: number;
};

/**
 * Groups evidence cards by source (its key, or its link when it has none), keeping first-seen order.
 *
 * @param cards - One draft's evidence cards
 * @returns One group per source
 */
export function groupBySource(cards: EvidenceCard[]): SourceGroup[] {
  const groups = new Map<string, SourceGroup>();
  for (const c of cards) {
    const key = c.sourceKey ?? c.uri;
    const g = groups.get(key) ?? { key, title: c.title, uri: c.uri, quotes: [], found: 0 };
    g.quotes.push(c);
    if (c.quote) g.found += 1;
    groups.set(key, g);
  }
  return [...groups.values()];
}

/**
 * Every warning about a quote, in plain words: one list decides both what the draft window shows and which quotes stay
 * open, so a warning can never sit inside a folded quote.
 */
export function quoteWarnings(c: EvidenceCard): string[] {
  return [
    !c.quote && "Quote not found in the saved source",
    c.changed && "The source changed after this draft was written",
    c.needsCheck && !c.changed && "Check this draft against the current source",
    c.truncated && "Only part of the source was read",
    c.kind === "video-description" && "Video description only",
    c.captions === "auto" && "Auto captions: check names",
    c.captions === "unknown" && "Caption type unknown: check names",
    c.paidPreview && "Paid preview only",
  ].filter((x): x is string => Boolean(x));
}

/** Whether a quote has any warning, so it must stay open. */
export function quoteNeedsAttention(c: EvidenceCard): boolean {
  return quoteWarnings(c).length > 0;
}
