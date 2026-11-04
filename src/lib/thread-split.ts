/**
 * @fileoverview Splits a draft that is too long for its network into a thread, the way Buffer's own "Split into
 * thread" works: only on networks Buffer threads (X, Threads, Mastodon, Bluesky), only when the text is over the
 * limit, and without changing a word. Each post is an exact piece of the original; only the whitespace between pieces
 * is dropped. Cuts prefer paragraph breaks, then line breaks, then sentence ends, then spaces, and never fall inside
 * a word or a link. Posts are counted the way Buffer counts them (char-limits.ts).
 */
import { countFor, limitFor } from "./char-limits";

/** Networks Buffer can post as a thread (developers.buffer.com, create-threaded-post). */
export const THREAD_NETWORKS = ["twitter", "threads", "mastodon", "bluesky"] as const;
/** Most posts Queue Pilot puts in one thread. */
export const MAX_THREAD = 25;

/** The outcome of a split: the posts in order, or why the text cannot become a thread. */
export type ThreadSplit = { ok: true; posts: string[] } | { ok: false; reason: "not-a-thread-network" | "fits" | "unsplittable" | "too-many" };

/** Break kinds, strongest first: a cut is made at the strongest break that keeps the post under the limit. */
const BREAKS: RegExp[] = [/\n\s*\n/g, /\n/g, /(?<=[.!?…])\s+/g, /\s+/g];
const URL_RE = /https?:\/\/\S+/g;

/** Positions where `text` may be cut by this break kind: the end of the text before the gap, and the start after it. */
function cutPoints(text: string, kind: RegExp): { end: number; next: number }[] {
  const urls = [...text.matchAll(URL_RE)].map((m) => [m.index!, m.index! + m[0].length]);
  const inUrl = (i: number) => urls.some(([a, b]) => i > a && i < b);
  return [...text.matchAll(kind)].filter((m) => m.index! > 0 && !inUrl(m.index!)).map((m) => ({ end: m.index!, next: m.index! + m[0].length }));
}

/**
 * Splits text into thread posts that each fit the network.
 *
 * @param service - Buffer's network name, such as twitter or bluesky
 * @param text - The draft, exactly as written
 * @returns The posts, each an unchanged piece of the text, or the reason it cannot be a thread
 */
export function splitThread(service: string, text: string): ThreadSplit {
  if (!(THREAD_NETWORKS as readonly string[]).includes(service)) return { ok: false, reason: "not-a-thread-network" };
  const limit = limitFor(service)!;
  const body = text.trim();
  if (countFor(service, body) <= limit) return { ok: false, reason: "fits" };

  const posts: string[] = [];
  let rest = body;
  while (countFor(service, rest) > limit) {
    let cut: { end: number; next: number } | undefined;
    // The strongest break that still leaves a full post; within one kind, the last cut that fits.
    for (const kind of BREAKS) {
      const fitting = cutPoints(rest, kind).filter((c) => countFor(service, rest.slice(0, c.end).trimEnd()) <= limit);
      if (fitting.length) { cut = fitting[fitting.length - 1]; break; }
    }
    if (!cut) return { ok: false, reason: "unsplittable" };
    posts.push(rest.slice(0, cut.end).trimEnd());
    rest = rest.slice(cut.next).trimStart();
    if (posts.length >= MAX_THREAD) return { ok: false, reason: "too-many" };
  }
  posts.push(rest);
  return { ok: true, posts };
}
