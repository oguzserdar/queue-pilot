/**
 * @fileoverview Tests for matching a directly connected account to its Buffer channel for account-limited rules.
 */
import { describe, expect, it } from "vitest";
import { matchRuleAccount } from "./rule-account";

const channels = [
  { id: "b-m1", name: "ada", service: "mastodon", serviceId: "42", externalLink: "https://mastodon.social/@ada" },
  { id: "b-m2", name: "ada", service: "mastodon", serviceId: "42", externalLink: "https://other.example/@ada" },
  { id: "b-bs", name: "ada.bsky.social", service: "bluesky", serviceId: "did:plc:ada", externalLink: "https://bsky.app/profile/ada.bsky.social" },
  { id: "b-li", name: "Ada", service: "linkedin", serviceId: "li-1" },
];

describe("matchRuleAccount", () => {
  it("matches by the network's own account id, and for Mastodon only on the same server", () => {
    expect(matchRuleAccount(channels, { network: "mastodon", accountId: "42", server: "https://mastodon.social" })).toEqual({ id: "b-m1", candidates: ["b-m1", "b-m2"] });
    expect(matchRuleAccount(channels, { network: "mastodon", accountId: "42", server: "https://OTHER.example/" })).toEqual({ id: "b-m2", candidates: ["b-m1", "b-m2"] });
    expect(matchRuleAccount(channels, { network: "bluesky", accountId: "did:plc:ada", server: "https://pds.example" })).toEqual({ id: "b-bs", candidates: ["b-bs"] });
  });

  it("never matches on the name alone: the same username on another server stays unsure", () => {
    expect(matchRuleAccount(channels, { network: "mastodon", accountId: "42", server: "https://third.example" })).toEqual({ candidates: ["b-m1", "b-m2"] });
    expect(matchRuleAccount(channels.map(({ serviceId: _s, externalLink: _e, ...c }) => c), { network: "mastodon", accountId: "42", server: "https://mastodon.social" })).toEqual({ candidates: ["b-m1", "b-m2"] });
  });

  it("has no candidates when Buffer has no account on that network", () => {
    expect(matchRuleAccount(channels.filter((c) => c.service !== "bluesky"), { network: "bluesky", accountId: "did:plc:ada", server: "x" })).toEqual({ candidates: [] });
  });
});
