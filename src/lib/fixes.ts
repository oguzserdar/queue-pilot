/**
 * Finds the fixes a person made to a draft Queue Pilot wrote, by comparing the saved text with what is in Buffer now,
 * and offers a fix made in two different drafts on one network as a playbook rule (src/lib/rules.ts).
 *
 * The comparison is a word-level diff (longest common subsequence). Each changed stretch is named as a rule kind the
 * checker can enforce: a short swap is "use this word", a cut is "never use", words added at the end are an ending.
 * A rewrite bigger than that is not treated as one fix.
 */

export type Fix =
  | { kind: "replace"; from: string; to: string }
  | { kind: "banned"; phrase: string }
  | { kind: "ends_with"; phrase: string };

export type Edit = { postId: string; network: string; before: string; after: string };
export type FixOffer = { fix: Fix; network: string; count: number; examples: { before: string; after: string }[] };

const MAX_SWAP_WORDS = 3;
const MAX_CUT_WORDS = 6;
const MAX_ENDING_WORDS = 12;
/** A change touching more than this share of the words is a rewrite, not a fix. */
const MAX_CHANGED_SHARE = 0.5;
const MIN_REPEATS = 2;

// Keep emoji graphemes intact (including skin tones, flags and joined families), even beside a word.
const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const emoji = /[\p{Extended_Pictographic}\p{Regional_Indicator}\u20e3]/u;
const words = (s: string) => [...graphemes.segment(s)].map(({ segment }) => emoji.test(segment) ? ` ${segment} ` : segment).join("").trim().split(/\s+/).filter(Boolean);
const clean = (w: string) => emoji.test(w) ? w : w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
/** Compare words without case or edge punctuation, preserving symbols so different emoji stay distinct. */
const norm = (w: string) => clean(w).toLowerCase() || w;
const bare = (ws: string[]) => ws.map(clean).filter(Boolean).join(" ");

type Hunk = { removed: string[]; added: string[]; atEnd: boolean };

/** The changed stretches between two word lists, from a longest-common-subsequence table. */
function hunks(a: string[], b: string[]): Hunk[] {
  const A = a.map(norm);
  const B = b.map(norm);
  const L = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out: Hunk[] = [];
  let i = 0;
  let j = 0;
  let cur: Hunk | null = null;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && A[i] === B[j]) {
      if (cur) out.push(cur);
      cur = null;
      i++;
      j++;
    } else {
      cur ??= { removed: [], added: [], atEnd: false };
      if (j < b.length && (i >= a.length || L[i][j + 1] >= L[i + 1][j])) cur.added.push(b[j++]);
      else cur.removed.push(a[i++]);
    }
  }
  if (cur) out.push({ ...cur, atEnd: true });
  return out;
}

/** The fixes between what Queue Pilot wrote and what the person left, or none when it was a rewrite. */
export function fixesIn(before: string, after: string): Fix[] {
  const a = words(before);
  const b = words(after);
  const hs = hunks(a, b);
  // Words added after the last word are an ending, not a rewrite, so they do not count towards the rewrite size.
  const changed = hs.reduce((n, h) => n + (h.atEnd && !h.removed.length ? 0 : Math.max(h.removed.length, h.added.length)), 0);
  if (!hs.length || changed / Math.max(a.length, 1) > MAX_CHANGED_SHARE) return [];
  const fixes: Fix[] = [];
  for (const h of hs) {
    // Punctuation-only changes are not word preferences and must never become empty rules.
    if (h.removed.length && !bare(h.removed)) continue;
    if (h.added.length && !bare(h.added)) continue;
    if (!h.removed.length && h.atEnd && h.added.length <= MAX_ENDING_WORDS) fixes.push({ kind: "ends_with", phrase: h.added.join(" ") });
    else if (h.removed.length && h.added.length && h.removed.length <= MAX_SWAP_WORDS && h.added.length <= MAX_SWAP_WORDS)
      fixes.push({ kind: "replace", from: bare(h.removed).toLowerCase(), to: bare(h.added).toLowerCase() });
    else if (h.removed.length && h.removed.length <= MAX_CUT_WORDS) fixes.push({ kind: "banned", phrase: bare(h.removed) });
  }
  return fixes;
}

const fixKey = (f: Fix) => (f.kind === "replace" ? `replace:${f.from}>${f.to}` : `${f.kind}:${f.phrase.toLowerCase()}`);

/** Fixes made in at least two different drafts on the same network, most repeated first. */
export function repeatedFixes(edits: Edit[]): FixOffer[] {
  const seen = new Map<string, { fix: Fix; network: string; posts: Set<string>; examples: { before: string; after: string }[] }>();
  for (const e of edits) {
    for (const fix of fixesIn(e.before, e.after)) {
      const key = `${e.network}|${fixKey(fix)}`;
      const entry = seen.get(key) ?? { fix, network: e.network, posts: new Set<string>(), examples: [] };
      if (!entry.posts.has(e.postId)) {
        entry.posts.add(e.postId);
        entry.examples.push({ before: e.before, after: e.after });
      }
      seen.set(key, entry);
    }
  }
  return [...seen.values()]
    .filter((s) => s.posts.size >= MIN_REPEATS)
    .map((s) => ({ fix: s.fix, network: s.network, count: s.posts.size, examples: s.examples }))
    .sort((x, y) => y.count - x.count);
}
