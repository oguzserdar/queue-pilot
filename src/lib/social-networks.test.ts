/**
 * @fileoverview The network lists stay in step with the table of what Queue Pilot does on each network, so a network
 * added to the table without its list entry (or the reverse) fails here.
 */
import { describe, expect, it } from "vitest";
import { NETWORKS, POSTING_NETWORKS, SOCIAL_NETWORKS, isPostingNetwork, isReplyNetwork, isSocialNetwork } from "./social-networks";

describe("social networks", () => {
  it("lists every network in the table, and only those", () => {
    expect([...SOCIAL_NETWORKS].sort()).toEqual(Object.keys(NETWORKS).sort());
  });

  it("lists exactly the networks the table says Queue Pilot posts to", () => {
    expect([...POSTING_NETWORKS].sort()).toEqual(Object.keys(NETWORKS).filter(isPostingNetwork).sort());
  });

  it("answers by the table, and refuses bots and unknown names", () => {
    for (const n of SOCIAL_NETWORKS) expect(isReplyNetwork(n)).toBe(NETWORKS[n].answers);
    for (const kind of ["telegram", "discord", "toString", ""]) {
      expect([isSocialNetwork(kind), isPostingNetwork(kind), isReplyNetwork(kind)]).toEqual([false, false, false]);
    }
  });
});
