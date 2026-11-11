import { describe, expect, it } from "vitest";
import { editsFrom, fixToRule, offerKey, openOffers } from "./fix-offers";
import { repeatedFixes } from "./fixes";
import type { Rule } from "./rules";

const written = [
  { postId: "p1", network: "linkedin", text: "A good broth starts cold." },
  { postId: "p2", network: "linkedin", text: "Broth is the base of winter." },
  { postId: "p3", network: "linkedin", text: "Unchanged post." },
];
const posts = [
  { id: "p1", text: "A good stock starts cold." },
  { id: "p2", text: "Stock is the base of winter." },
  { id: "p3", text: "Unchanged  post. " },
];

describe("fixToRule with the author's sentence", () => {
  it("makes an added ending the author's sentence, flagged and judged by meaning", () => {
    const fix = { kind: "ends_with" as const, phrase: "https://github.com/oguzserdar/queue-pilot" };
    expect(fixToRule(fix, "twitter", "ch1", "End posts about qp with the repo link.")).toMatchObject({ kind: "guidance", level: "warn", accountIds: ["ch1"], text: "End posts about qp with the repo link." });
  });

  it("keeps a swap or a cut as its exact, enforced words, since neither adds anything to a post", () => {
    expect(fixToRule({ kind: "replace", from: "queue pilot", to: "qp" }, "twitter", undefined, "Say qp.")).toMatchObject({ kind: "replace", from: "queue pilot", to: "qp", level: "block" });
    expect(fixToRule({ kind: "banned", phrase: "Excited to share" }, "twitter", undefined, "No hype openers.")).toMatchObject({ kind: "banned", level: "block" });
  });

  it("stops offering a fix once the rule kept from it is in the playbook", () => {
    const fix = { kind: "ends_with" as const, phrase: "https://github.com/oguzserdar/queue-pilot" };
    const offer = { fix, network: "twitter", count: 2, examples: [] };
    const kept = { ...fixToRule(fix, "twitter", undefined, "End posts about qp with the repo link."), id: "r1", learnedFrom: { fix, network: "twitter" } } as Rule;
    expect(openOffers([offer], [kept], new Set())).toEqual([]);
    expect(openOffers([offer], [{ ...kept, learnedFrom: { fix: { kind: "ends_with", phrase: "other" } } } as Rule], new Set())).toHaveLength(1);
  });
});

describe("editsFrom", () => {
  it("pairs what Queue Pilot wrote with the post's text now, only where the person changed it", () => {
    const edits = editsFrom(written, posts);
    expect(edits.map((e) => e.postId)).toEqual(["p1", "p2"]);
    expect(edits[0]).toEqual({ postId: "p1", network: "linkedin", before: "A good broth starts cold.", after: "A good stock starts cold." });
  });

  it("skips a post that is no longer in the queue", () => {
    expect(editsFrom(written, [{ id: "p1", text: "A good stock starts cold." }]).length).toBe(1);
  });
});

describe("fixToRule", () => {
  it("makes a swap an enforced rule for that network", () => {
    expect(fixToRule({ kind: "replace", from: "broth", to: "stock" }, "linkedin")).toMatchObject({ kind: "replace", from: "broth", to: "stock", channels: ["linkedin"], level: "block", text: 'Say "stock", never "broth".' });
  });

  it("makes an added ending a flagged rule", () => {
    expect(fixToRule({ kind: "ends_with", phrase: "Link in bio." }, "instagram")).toMatchObject({ kind: "ends_with", level: "warn", channels: ["instagram"] });
  });

  it("applies to every network when the network is not one Queue Pilot names", () => {
    expect(fixToRule({ kind: "banned", phrase: "Excited to share" }, "pinterest")).toMatchObject({ channels: "all" });
  });
});

describe("openOffers", () => {
  const offers = repeatedFixes(editsFrom(written, posts));

  it("offers a repeated fix that is not a rule yet", () => {
    expect(openOffers(offers, [], new Set()).length).toBe(1);
  });

  it("does not offer a fix that is already a rule", () => {
    const rules: Rule[] = [{ id: "r1", kind: "replace", from: "broth", to: "stock", channels: "all", level: "block", text: "x" }];
    expect(openOffers(offers, rules, new Set())).toEqual([]);
  });

  it("does not offer a fix the person said Not now to", () => {
    expect(openOffers(offers, [], new Set([offerKey(offers[0])]))).toEqual([]);
  });
});

it("does not pool matching fixes across two LinkedIn accounts", () => {
  const split = editsFrom(written, posts.map((p, i) => ({ ...p, channelId: i === 0 ? "company" : "personal" })));
  expect(repeatedFixes(split)).toEqual([]);
  const together = repeatedFixes(editsFrom(written, posts.map(p => ({ ...p, channelId: "company" }))));
  expect(together).toHaveLength(1);
  expect(together[0].channelId).toBe("company");
  expect(fixToRule(together[0].fix, together[0].network, together[0].channelId).accountIds).toEqual(["company"]);
  const other: Rule = { id: "r", ...fixToRule(together[0].fix, "linkedin", "personal") };
  expect(openOffers(together, [other], new Set())).toHaveLength(1);
});
