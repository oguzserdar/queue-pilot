/** Fictional channels shared by the example account and its sidebar. */
export type ChannelId = "linkedin" | "instagram" | "bluesky" | "x";

export type Channel = {
  id: ChannelId;
  name: string;
  /** Buffer's network name, as on a real channel. */
  service: string;
  handle: string;
  isDisconnected: boolean;
  isQueuePaused: boolean;
};


export const channels: Channel[] = [
  { id: "linkedin", service: "linkedin", name: "LinkedIn", handle: "Mark Evans", isDisconnected: false, isQueuePaused: false },
  { id: "instagram", service: "instagram", name: "Instagram", handle: "@weeknightdinners", isDisconnected: false, isQueuePaused: false },
  { id: "bluesky", service: "bluesky", name: "Bluesky", handle: "weeknightdinners.bsky.social", isDisconnected: true, isQueuePaused: false },
  { id: "x", service: "twitter", name: "X", handle: "@weeknightdinners", isDisconnected: false, isQueuePaused: false },
];
