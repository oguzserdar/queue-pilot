/**
 * @fileoverview The networks Queue Pilot posts to with a person's own account (not a bot): one list, so adding a
 * network is one entry here plus its sender, never a hunt for every place that named the others. Browser-safe.
 */

/** Networks connected with the person's own account. Telegram and Discord are bots, not listed here. */
export const SOCIAL_NETWORKS = ["mastodon", "bluesky"] as const;
export type SocialNetwork = (typeof SOCIAL_NETWORKS)[number];

/** True for a network connected with the person's own account. */
export const isSocialNetwork = (kind: string): kind is SocialNetwork => SOCIAL_NETWORKS.some((n) => n === kind);
