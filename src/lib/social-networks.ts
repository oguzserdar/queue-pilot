/**
 * @fileoverview The networks Queue Pilot reaches with a person's own account (not a bot), and what it does on each:
 * posts there, answers mentions and messages there, or both. One table, so adding a network is one entry here plus
 * its sender, and the type checker then lists every place that has to handle it. Browser-safe.
 */

/** What Queue Pilot does on each network. A network without text-only posts (Instagram) only answers. */
export const NETWORKS = {
  mastodon: { posts: true, answers: true },
  bluesky: { posts: true, answers: true },
  // No text-only posts (an image or video is required), so only comments and messages are answered.
  instagram: { posts: false, answers: true },
} as const satisfies Record<string, { posts: boolean; answers: boolean }>;

/** Networks connected with the person's own account. Telegram and Discord are bots, not listed here. */
export type SocialNetwork = keyof typeof NETWORKS;
/** The networks Queue Pilot posts to: the composer, the direct-post store and the week. */
export type PostingNetwork = { [N in SocialNetwork]: (typeof NETWORKS)[N]["posts"] extends true ? N : never }[SocialNetwork];
/** The networks where Queue Pilot answers mentions and messages: the replies run and automations. */
export type ReplyNetwork = { [N in SocialNetwork]: (typeof NETWORKS)[N]["answers"] extends true ? N : never }[SocialNetwork];

const isNetwork = (kind: string): kind is SocialNetwork => Object.hasOwn(NETWORKS, kind);

/** Every network connected with the person's own account, in table order. */
export const SOCIAL_NETWORKS = ["mastodon", "bluesky", "instagram"] as const satisfies readonly SocialNetwork[];
/** The networks Queue Pilot posts to. */
export const POSTING_NETWORKS = ["mastodon", "bluesky"] as const satisfies readonly PostingNetwork[];

/** True for a network connected with the person's own account. */
export const isSocialNetwork = (kind: string): kind is SocialNetwork => isNetwork(kind);
/** True for a network Queue Pilot posts to. */
export const isPostingNetwork = (kind: string): kind is PostingNetwork => isNetwork(kind) && NETWORKS[kind].posts;
/** True for a network where Queue Pilot answers mentions and messages. */
export const isReplyNetwork = (kind: string): kind is ReplyNetwork => isNetwork(kind) && NETWORKS[kind].answers;
