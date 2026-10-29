/**
 * Pre-flight checks that run before a draft is approved, so a post that cannot go out is caught while there is time to fix it.
 * Each check returns a plain-language result; "fail" means the post would not publish as it stands.
 */
import type { Channel } from "./buffer/queries";

export type Check = { name: string; result: "pass" | "warn" | "fail"; detail: string };

/** Whether Buffer can publish to this channel right now, from the channel's own status flags. */
export function channelCheck(channel: Pick<Channel, "name" | "isDisconnected" | "isLocked" | "isQueuePaused">): Check {
  const name = "Channel can post";
  if (channel.isDisconnected) return { name, result: "fail", detail: `${channel.name} is disconnected in Buffer. Reconnect it in Buffer and this clears on its own.` };
  if (channel.isLocked) return { name, result: "fail", detail: `${channel.name} is locked in Buffer, usually because of the plan's channel limit.` };
  if (channel.isQueuePaused) return { name, result: "fail", detail: `The queue for ${channel.name} is paused in Buffer, so nothing in it will publish.` };
  return { name, result: "pass", detail: `${channel.name} is connected and its queue is running.` };
}
