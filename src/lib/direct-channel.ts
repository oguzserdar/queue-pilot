/**
 * @fileoverview How a directly connected account (Mastodon, Bluesky) shows as a channel in the week: its channel id is
 * "direct:" and the account's row id, so it can never collide with a Buffer channel id. Safe in the browser.
 */

/** The prefix that marks a week channel id as a direct account, never a Buffer channel. */
export const DIRECT_PREFIX = "direct:";

/** The account row id inside a direct channel id, or null for a Buffer channel id. */
export const directAccountId = (channelId: string): string | null => (channelId.startsWith(DIRECT_PREFIX) ? channelId.slice(DIRECT_PREFIX.length) : null);
