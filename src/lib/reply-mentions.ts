/**
 * @fileoverview How a reply names the person it answers on Mastodon: the full acct, and the @acct a reply starts with.
 * Plain text work with no network or database, so the reply engine and any screen can use it.
 */

/** A Mastodon acct as user@host, lower case: a local account gets its instance's host. */
export function fullAcct(acct: string, server: string): string {
  const bare = acct.replace(/^@/, "");
  return (bare.includes("@") ? bare : `${bare}@${new URL(server).host}`).toLowerCase();
}

/** The text with @acct at its start, added once when the draft does not already begin with it. */
export function withMention(text: string, acct: string): string {
  const tag = `@${acct}`;
  const head = text.slice(0, tag.length).toLowerCase();
  const next = text.charAt(tag.length);
  return head === tag.toLowerCase() && (next === "" || /\s/.test(next)) ? text : `${tag} ${text}`;
}
