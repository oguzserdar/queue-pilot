import "server-only";
/**
 * Reads what the user publishes (Substack, blog, YouTube, GitHub releases) from its RSS or Atom feed, so their AI
 * drafts from real work. Parsing is @rowanmanning/feed-parser (RSS, Atom, RDF normalised); fetching goes through
 * safeFetch (public addresses only, redirects re-checked) with a time and size limit, because the URL is user input.
 */
import { parseFeed } from "@rowanmanning/feed-parser";
import { BlockedAddressError, safeFetch } from "./safe-fetch";

export type FeedItem = {
  /** Stable key for "already used": the feed's own id, else the link, else the title. */
  key: string;
  title: string;
  url: string | null;
  /** ISO date, or null when the feed gives none. */
  published: string | null;
  /** Plain-text summary, at most SUMMARY_CHARS. */
  summary: string;
  /** The item's full text as the feed carries it (its content, else its description), plain, at most BODY_CHARS. */
  body: string;
  /** True when QP truncated the body or the publisher ends it with a Read more link. */
  truncated?: boolean;
};

/** An error whose message is written for the person adding the feed; anything else is shown as a generic sentence. */
export class FeedError extends Error {}

export const SUMMARY_CHARS = 600;
export const BODY_CHARS = 12_000;
// A long-running newsletter serves its last twenty issues in full: a few megabytes is normal.
const MAX_BYTES = 8_000_000;
const TIMEOUT_MS = 10_000;

/** Strips tags and collapses whitespace; feeds put HTML in descriptions. */
export function plainText(html: string): string {
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const XML_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

/**
 * Media RSS descriptions by item link. YouTube's channel feed carries a video's description only in
 * media:group/media:description, which the parser does not expose, so it is read from each entry's own XML.
 */
function mediaDescriptions(xml: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const [entry] of xml.matchAll(/<(entry|item)\b[\s\S]*?<\/\1>/g)) {
    const link = entry.match(/<link\b[^>]*\brel="alternate"[^>]*\bhref="([^"]+)"/)?.[1] ?? entry.match(/<link>([^<]+)<\/link>/)?.[1];
    const desc = entry.match(/<media:description\b[^>]*>([\s\S]*?)<\/media:description>/)?.[1];
    if (!link || !desc) continue;
    const text = desc.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&(amp|lt|gt|quot|apos);/g, (_, e: string) => XML_ENTITIES[e]);
    out.set(link.replace(/&amp;/g, "&"), text);
  }
  return out;
}

/** Parses feed XML into items, newest first. Throws when the text is not a feed. */
export function itemsFromXml(xml: string): { title: string | null; items: FeedItem[] } {
  const feed = parseFeed(xml);
  const media = xml.includes("media:description") ? mediaDescriptions(xml) : new Map<string, string>();
  const items = feed.items
    .map((it) => {
      const fromMedia = it.url ? media.get(it.url) : undefined;
      const summary = plainText(it.description ?? it.content ?? fromMedia ?? "");
      // Many feeds put a teaser in the description and the whole post in content; the body prefers the whole post.
      const html = it.content ?? it.description ?? fromMedia ?? "";
      const full = plainText(html);
      const excerpt = full.length > BODY_CHARS || /<a\b[^>]*>\s*Read more\s*<\/a>\s*(?:<\/p>)?\s*$/i.test(html);
      const title = (it.title ?? "").trim() || summary.slice(0, 80) || "(untitled)";
      return {
        ...(excerpt ? { truncated: true } : {}),
        key: it.id ?? it.url ?? title,
        title,
        url: it.url ?? null,
        published: (it.published ?? it.updated)?.toISOString() ?? null,
        summary: summary.length > SUMMARY_CHARS ? `${summary.slice(0, SUMMARY_CHARS - 1)}…` : summary,
        body: full.length > BODY_CHARS ? `${full.slice(0, BODY_CHARS - 1)}…` : full,
      };
    })
    .sort((a, b) => (b.published ?? "").localeCompare(a.published ?? ""));
  return { title: feed.title ?? null, items };
}

/** Splits a scoped key ("sourceId:itemKey") back into its feed id and the item's own key; null when malformed. */
export function splitKey(key: string): { sourceId: string; itemKey: string } | null {
  const i = key.indexOf(":");
  if (i <= 0 || i === key.length - 1) return null;
  return { sourceId: key.slice(0, i), itemKey: key.slice(i + 1) };
}

/** Gives every item a key unique across the user's feeds: the feed's id, then the item's own key. */
export function scopeKeys(sourceId: string, items: FeedItem[]): FeedItem[] {
  return items.map((i) => ({ ...i, key: `${sourceId}:${i.key}` }));
}

/** The items not used yet, newest first, at most `limit`. */
export function newItems(items: FeedItem[], usedKeys: Set<string>, limit = 10): FeedItem[] {
  return items.filter((i) => !usedKeys.has(i.key)).slice(0, limit);
}

/** Old/undated items remain readable as background, but are not offered as fresh news. */
export function freshItems(items: FeedItem[], usedKeys: Set<string>, sourceUrl: string, limit = 10, now = new Date()): FeedItem[] {
  const cutoff = now.getTime() - 14 * 24 * 60 * 60 * 1000;
  const recent = items.filter(item => {
    const date = item.published ? Date.parse(item.published) : NaN;
    return date >= cutoff && date <= now.getTime();
  }).sort((a, b) => b.published!.localeCompare(a.published!));
  const url = new URL(sourceUrl);
  // Filter before checking usage: using the latest release must not expose an older version next time.
  const candidates = url.hostname === "github.com" && /^\/[^/]+\/[^/]+\/releases(?:\.atom)?\/?$/.test(url.pathname)
    ? recent.slice(0, 1) : recent;
  return newItems(candidates, usedKeys, limit);
}

/** Reads a response body, stopping as soon as it passes `max` bytes, so an undeclared huge body is never held whole. */
export async function readCapped(res: Response, max: number): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      throw new FeedError("The feed is too large to read.");
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

/** Turns a repository release page into its feed address. Other addresses stay as given. */
export function feedUrl(url: string): string {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new FeedError("That is not a web address.")
  }
  if (parsed.hostname === "github.com" && /^\/[^/]+\/[^/]+\/releases\/?$/.test(parsed.pathname)) {
    parsed.pathname = `${parsed.pathname.replace(/\/$/, "")}.atom`
    parsed.search = ""
    parsed.hash = ""
  }
  return parsed.toString()
}

/** Fetches a public address as text, with the feed reader's time and size limits. Errors are written for people. */
async function fetchText(parsed: URL, accept: string): Promise<string> {
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new FeedError("That is not a web address.");
  let res: Response;
  try {
    res = await safeFetch(parsed, { headers: { accept }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (e) {
    if (e instanceof BlockedAddressError) throw new FeedError("That address is not on the public internet.");
    if (e instanceof Error && e.name === "TimeoutError") throw new FeedError("The feed took too long to answer.");
    throw new FeedError("The feed could not be reached.");
  }
  if (!res.ok) throw new FeedError(`The feed answered ${res.status}.`);
  const length = Number(res.headers.get("content-length") ?? 0);
  if (length > MAX_BYTES) throw new FeedError("The feed is too large to read.");
  return readCapped(res, MAX_BYTES);
}

const FEED_ACCEPT = "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9";

/** Fetches and parses a feed URL. Errors carry a sentence the user can act on. */
export async function readFeed(url: string): Promise<{ title: string | null; items: FeedItem[] }> {
  let parsed: URL;
  try {
    parsed = new URL(feedUrl(url))
  } catch {
    throw new FeedError("That is not a web address.");
  }
  const text = await fetchText(parsed, FEED_ACCEPT);
  try {
    return itemsFromXml(text);
  } catch {
    throw new FeedError("That address is not an RSS or Atom feed.");
  }
}

/**
 * The feed addresses a web page points to, most likely first: the feed it names in a `<link rel="alternate">` tag, a
 * video channel's own feed, then the usual feed paths under the page and the site.
 *
 * @param html - The page as fetched
 * @param page - The page's address, for resolving relative links
 * @returns Absolute addresses, without duplicates; empty when the page offers nothing to try
 */
export function feedCandidates(html: string, page: URL): string[] {
  const out: string[] = [];
  const add = (href: string | undefined) => {
    if (!href) return;
    try {
      const u = new URL(href.replace(/&amp;/g, "&"), page);
      if ((u.protocol === "https:" || u.protocol === "http:") && !out.includes(u.toString())) out.push(u.toString());
    } catch { /* A malformed link is skipped. */ }
  };
  // Feed links sit in the head, so only the start of the page is read, and a tag never runs past the next "<":
  // an unclosed tag on a hostile page cannot make this scan slow.
  html = html.slice(0, SCAN_CHARS);
  for (const [tag] of html.matchAll(/<link\b[^<>]*>/gi)) {
    if (!/\brel=["']?alternate/i.test(tag) || !/type=["']application\/(?:rss|atom)\+xml/i.test(tag)) continue;
    add(tag.match(/\bhref=["']([^"']+)["']/i)?.[1]);
  }
  const channel = html.match(/(?:channel_id=|"channelId":"|\/channel\/)(UC[\w-]{22})/)?.[1];
  if (channel && /(^|\.)youtube\.com$/.test(page.hostname)) add(`https://www.youtube.com/feeds/videos.xml?channel_id=${channel}`);
  const base = page.pathname.replace(/\/$/, "");
  for (const path of [`${base}/feed`, `${base}/rss/`, "/feed", "/rss.xml", "/atom.xml"]) add(path);
  return out;
}

/** How much of a page feedCandidates reads. */
const SCAN_CHARS = 200_000;
/** The longest findFeed spends on the addresses a page points to, all together. */
const FIND_MS = 20_000;
/** How many addresses findFeed tries after the one it was given. */
const MAX_CANDIDATES = 5;

/**
 * Finds the feed behind what a person pasted: the feed itself, or the site, newsletter or channel page it belongs to.
 *
 * People paste the address they know, which is usually the page, not its feed. Used when a feed is added, never on
 * later reads: the address returned is the feed's own and is what gets saved.
 *
 * @param url - What the person pasted
 * @returns The feed's address and its current items
 * @throws FeedError with a sentence the person can act on when no feed is found
 */
export async function findFeed(url: string): Promise<{ address: string; title: string | null; items: FeedItem[] }> {
  let parsed: URL;
  try {
    parsed = new URL(feedUrl(/^https?:\/\//i.test(url.trim()) ? url.trim() : `https://${url.trim()}`));
  } catch {
    throw new FeedError("That is not a web address.");
  }
  const text = await fetchText(parsed, `${FEED_ACCEPT}, text/html;q=0.8`);
  try {
    return { address: parsed.toString(), ...itemsFromXml(text) };
  } catch { /* Not a feed itself: look for the one the page points to. */ }
  const deadline = Date.now() + FIND_MS;
  for (const candidate of feedCandidates(text, parsed).slice(0, MAX_CANDIDATES)) {
    if (Date.now() > deadline) break;
    try {
      return { address: candidate, ...itemsFromXml(await fetchText(new URL(candidate), FEED_ACCEPT)) };
    } catch { /* Try the next address. */ }
  }
  throw new FeedError("No feed was found at that address. Paste the feed's own address: for a newsletter it usually ends in /feed, for a blog in /rss or /atom.xml.");
}
