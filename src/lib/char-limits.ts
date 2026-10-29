/**
 * Per-network text limits and counting rules, from Buffer's guide (developers.buffer.com/guides/character-limits.md,
 * read 21 Oct 2026). Buffer rejects over-limit text, and createContentItem is all-or-nothing, so one long post would
 * sink every post saved with it; checking first lets us refuse just that one with a clear reason.
 * X is checked against the Free limit (280): we cannot see the account's X plan, and a false "too long" is cheaper
 * than a whole group refused.
 */

const LIMITS: Record<string, number> = {
  facebook: 5000,
  instagram: 2196,
  twitter: 280,
  linkedin: 3000,
  pinterest: 500,
  tiktok: 4000,
  threads: 500,
  bluesky: 300,
  youtube: 5000,
  googlebusiness: 4000,
  mastodon: 500,
};

const URL_RE = /https?:\/\/[^\s]+/g;

/** UTF-16 code units: a character outside the Basic Multilingual Plane (most emoji) counts as two. */
const utf16 = (s: string) => s.length;

function withUrls(text: string, weight: (url: string) => number, count: (s: string) => number): number {
  let total = 0;
  for (const m of text.matchAll(URL_RE)) total += weight(m[0]);
  return total + count(text.replace(URL_RE, ""));
}

function graphemes(s: string): number {
  return [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(s)].length;
}

/** How Buffer counts this text for a network. */
export function countFor(service: string, text: string): number {
  switch (service) {
    case "twitter":
      // Weighted count: a URL is 23, a character outside the BMP (emoji) is 2.
      return withUrls(text, () => 23, (s) => [...s].reduce((n, ch) => n + ((ch.codePointAt(0) ?? 0) > 0xffff ? 2 : 1), 0));
    case "linkedin":
      return withUrls(text, () => 24, utf16);
    case "instagram":
      return utf16(text) + (text.match(/\n/g)?.length ?? 0);
    case "bluesky":
      return withUrls(text, (u) => { try { return new URL(u).host.length + 16; } catch { return u.length; } }, graphemes);
    case "mastodon":
      return withUrls(text, () => 23, utf16);
    default:
      return utf16(text);
  }
}

/** The limit Buffer applies to this network, or null when we do not know one. */
export const limitFor = (service: string): number | null => LIMITS[service] ?? null;

/** A reason the text is too long for the network, or null when it fits (or the network has no known limit). */
export function tooLong(service: string, text: string): string | null {
  const limit = limitFor(service);
  if (limit === null) return null;
  const n = countFor(service, text);
  return n > limit ? `${n} characters; ${service === "twitter" ? "X" : service} allows ${limit}` : null;
}
