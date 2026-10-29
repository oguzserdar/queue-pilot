/**
 * The checks every draft goes through before Queue Pilot saves it in Buffer, besides the playbook rules. Shown on the
 * Playbook page; there are no switches for them.
 */
export const DRAFT_CHECKS = [
  { name: "Channel can post", note: "Stops a draft for a channel that is disconnected, locked or paused in Buffer." },
  { name: "Fits the network", note: "Counts characters the way each network does, such as 280 on X." },
  { name: "Daily posting limit", note: "Asks Buffer whether the slot would go over the network's daily limit." },
  { name: "Image link loads", note: "Opens every image link, so a broken picture never reaches your approval." },
] as const;
