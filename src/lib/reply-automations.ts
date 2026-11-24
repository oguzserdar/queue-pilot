/**
 * @fileoverview Choosing the automation that answers a mention on one connected account: which post it is for, which
 * words it waits for, and which of its fixed reply versions to send. Pure logic, no database or AI: keyword matching
 * is plain text comparison, never a model. Imported by the settings screen as well, so it
 * uses nothing server-only.
 *
 * An account with no active automation answers every new mention in the person's voice, as before. Once it has one,
 * only mentions an automation matches are answered; the rest still reach the inbox.
 */

/** Which posts an automation answers comments on. */
export type AutomationPost = { scope: "any" } | { scope: "post"; externalId: string };

export type ReplyAutomation = {
  id: string;
  active: boolean;
  post: AutomationPost;
  /** Words or phrases that trigger it, matched as whole words; empty means any comment. */
  keywords: string[];
  /** "voice": the AI writes the reply in the person's voice; "fixed": one of `replyTexts`. Both pass the rules and judge. */
  replyMode: "voice" | "fixed";
  /** The fixed reply's versions, so public replies do not all read the same. */
  replyTexts: string[];
  /** A link the reply must carry; a reply without it is held. */
  link: string | null;
  createdAt: Date;
};

/** The most fixed reply versions one automation may hold. */
export const MAX_REPLY_VERSIONS = 10;
/** The most keywords one automation may hold. */
export const MAX_KEYWORDS = 20;

/**
 * Same letters compare the same: compatibility forms folded (full-width, composed accents), case ignored, and the
 * Turkish dotted and dotless i read as one letter ("LİNK" lowercases to i plus a combining dot, "KILAVUZ" to a plain
 * i while the keyword has ı), since a keyword match should not depend on which keyboard the commenter used.
 */
const fold = (s: string) => s.normalize("NFKC").toLocaleLowerCase("und").normalize("NFD").replace(/i\u0307/g, "i").replace(/ı/g, "i").normalize("NFC");

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * True when the text holds one of the keywords as whole words (so "guide" does not match "guidelines").
 *
 * @param text - The comment
 * @param keywords - The automation's keywords; empty matches any text
 */
export function keywordMatches(text: string, keywords: string[]): boolean {
  if (!keywords.length) return true;
  const t = fold(text);
  return keywords.some((k) => {
    const w = fold(k).trim();
    if (!w) return false;
    // Combining marks (accents, vowel signs) and zero-width joiners belong to the word they sit in, so they are not edges.
    return new RegExp(`(?<![\\p{L}\\p{N}\\p{M}\\u200c\\u200d])${escape(w)}(?![\\p{L}\\p{N}\\p{M}\\u200c\\u200d])`, "u").test(t);
  });
}

/**
 * The post's own id from however it was given: a pasted link (mastodon.social/@ada/111, bsky.app/profile/ada/post/3k),
 * a network URI (at://did/app.bsky.feed.post/3k) or a bare id. Both networks end the link with the post's id, so the
 * last path part is compared. On Mastodon a comment is matched by the post it answers directly.
 */
export function postRef(ref: string): string {
  return ref.trim().replace(/[?#].*$/, "").replace(/\/+$/, "").split("/").pop() ?? "";
}

/**
 * The automation that answers this mention, or null when none does (or the account has none).
 * One for this exact post wins over one for any post; between equals, the older one wins.
 *
 * @param automations - The account's automations
 * @param mention - The mention's text, the post that starts its thread, and the post it answers directly
 * @param opts - `owner`: the connected account's id on the network (a Bluesky DID); an at:// post must be its own
 */
export function matchAutomation<A extends ReplyAutomation>(automations: A[], mention: { text: string; postExternalId: string | null; parentExternalId?: string | null }, opts: { owner?: string } = {}): A | null {
  // A comment counts as on a post when it answers that post directly or the post starts its thread.
  const posts = [mention.parentExternalId, mention.postExternalId].filter((p): p is string => !!p);
  const onPost = (ref: string) => posts.some((post) => postRef(ref) === postRef(post)
    // Any Bluesky account can choose a record key, so the key alone could match another account's post: an at:// post
    // must also be the connected account's own.
    && (!post.startsWith("at://") || (!!opts.owner && post.startsWith(`at://${opts.owner}/`))));
  const fits = automations.filter((a) =>
    a.active
    && (a.post.scope === "any" || (a.post.scope === "post" && onPost(a.post.externalId)))
    && keywordMatches(mention.text, a.keywords));
  fits.sort((x, y) => Number(y.post.scope === "post") - Number(x.post.scope === "post") || x.createdAt.getTime() - y.createdAt.getTime());
  return fits[0] ?? null;
}

/**
 * One of the fixed reply versions, chosen from the inbound message's id, so a retry of the same reply sends the
 * same words (Mastodon's idempotency key hashes the text).
 *
 * @param texts - The versions; at least one
 * @param inboundId - The stored inbound message's id
 */
export function pickVersion(texts: string[], inboundId: string): string {
  // FNV-1a: stable and spread enough to vary the versions; no node:crypto, so the settings screen can use this file too.
  let n = 0x811c9dc5;
  for (let i = 0; i < inboundId.length; i += 1) n = Math.imul(n ^ inboundId.charCodeAt(i), 0x01000193) >>> 0;
  return texts[n % texts.length];
}

/**
 * True when the text links to the automation's link and to nothing else. A written reply must carry the owner's link
 * exactly; one that wraps it in another address (https://evil.example/?next=<link>) or adds any other link is held.
 *
 * @param text - The written reply
 * @param link - The automation's link
 */
export function linksAllowed(text: string, link: string): boolean {
  const found = (text.match(/https?:\/\/[^\s<>"'`]+/gi) ?? []).map((u) => u.replace(/[.,;:!?)\]}»”’]+$/, ""));
  return found.length > 0 && found.every((u) => u === link);
}
