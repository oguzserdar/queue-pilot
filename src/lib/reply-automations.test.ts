/**
 * @fileoverview Tests for choosing the automation that answers a mention: post scope, keyword match, reply version.
 */
import { describe, expect, it } from "vitest";
import { keywordMatches, matchAutomation, pickVersion, type ReplyAutomation } from "./reply-automations";

const auto = (over: Partial<ReplyAutomation>): ReplyAutomation => ({
  id: "a1", active: true, post: { scope: "any" }, keywords: [], replyMode: "voice", replyTexts: [], link: null, createdAt: new Date("2026-11-15T09:00:00Z"), ...over,
});

describe("keywordMatches", () => {
  it("matches a keyword anywhere in the text, ignoring case, accents written two ways, and full-width letters", () => {
    expect(keywordMatches("Send me the GUIDE please", ["guide"])).toBe(true);
    expect(keywordMatches("café?", ["café"])).toBe(true);
    expect(keywordMatches("ＧＵＩＤＥ", ["guide"])).toBe(true);
  });

  it("matches whole words only, so a keyword inside another word does not count", () => {
    expect(keywordMatches("guidelines?", ["guide"])).toBe(false);
    expect(keywordMatches("guide!", ["guide"])).toBe(true);
  });

  it("treats no keywords as any comment", () => {
    expect(keywordMatches("anything", [])).toBe(true);
  });
});

describe("matchAutomation", () => {
  const m = { text: "price?", postExternalId: "p1" };
  it("returns null when the account has no active automation, so replies work as before", () => {
    expect(matchAutomation([], m)).toBeNull();
    expect(matchAutomation([auto({ active: false })], m)).toBeNull();
  });

  it("prefers an automation for this exact post over one for any post, then the older one", () => {
    const any = auto({ id: "any", keywords: ["price"] });
    const post = auto({ id: "post", post: { scope: "post", externalId: "p1" }, keywords: ["price"], createdAt: new Date("2026-11-16T00:00:00Z") });
    expect(matchAutomation([any, post], m)?.id).toBe("post");
    expect(matchAutomation([auto({ id: "new", createdAt: new Date("2026-11-16T00:00:00Z") }), auto({ id: "old" })], m)?.id).toBe("old");
  });

  it("does not match another post or a missing keyword", () => {
    expect(matchAutomation([auto({ post: { scope: "post", externalId: "p2" } })], m)).toBeNull();
    expect(matchAutomation([auto({ keywords: ["link"] })], m)).toBeNull();
  });
});

describe("pickVersion", () => {
  it("picks the same version for the same mention every time, so a retry sends the same words", () => {
    const texts = ["A", "B", "C"];
    expect(pickVersion(texts, "in-1")).toBe(pickVersion(texts, "in-1"));
    const seen = new Set(Array.from({ length: 40 }, (_, i) => pickVersion(texts, `in-${i}`)));
    expect(seen.size).toBe(3);
  });
});

describe("postRef", () => {
  it("reads the post id from a pasted link, a network URI or a bare id", async () => {
    const { postRef } = await import("./reply-automations");
    expect(postRef("https://mastodon.social/@ada/111?x=1")).toBe("111");
    expect(postRef("https://bsky.app/profile/ada.bsky.social/post/3kabc/")).toBe("3kabc");
    expect(postRef("at://did:plc:ada/app.bsky.feed.post/3kabc")).toBe("3kabc");
    expect(postRef(" 111 ")).toBe("111");
  });
});

describe("keywordMatches in Turkish", () => {
  it("matches dotted and dotless I the way Turkish writers type them", () => {
    expect(keywordMatches("LİNK lütfen", ["link"])).toBe(true);
    expect(keywordMatches("KILAVUZ var mı?", ["kılavuz"])).toBe(true);
  });
});

describe("a one-post automation on Bluesky", () => {
  it("matches only the account's own post, never another account's post with the same record key", () => {
    const a = auto({ post: { scope: "post", externalId: "https://bsky.app/profile/ada.bsky.social/post/3target" } });
    expect(matchAutomation([a], { text: "x", postExternalId: "at://did:plc:ada/app.bsky.feed.post/3target" }, { owner: "did:plc:ada" })?.id).toBe("a1");
    expect(matchAutomation([a], { text: "x", postExternalId: "at://did:plc:attacker/app.bsky.feed.post/3target" }, { owner: "did:plc:ada" })).toBeNull();
  });
});

describe("keywordMatches with combining marks", () => {
  it("does not treat an accent or a vowel sign as the end of a word", () => {
    expect(keywordMatches("guide\u0338lines", ["guide"])).toBe(false);
    expect(keywordMatches("कि", ["क"])).toBe(false);
    expect(keywordMatches("क?", ["क"])).toBe(true);
  });
});

describe("linksAllowed", () => {
  it("allows only the automation's own link, never a link that merely contains it", async () => {
    const { linksAllowed } = await import("./reply-automations");
    const link = "https://owner.example/guide";
    expect(linksAllowed(`Here: ${link}`, link)).toBe(true);
    expect(linksAllowed(`Here: ${link}.`, link)).toBe(true);
    expect(linksAllowed(`Here: https://evil.example/?next=${link}`, link)).toBe(false);
    expect(linksAllowed(`Here: ${link} and https://other.example`, link)).toBe(false);
    expect(linksAllowed(`Here: ${link}x`, link)).toBe(false);
    expect(linksAllowed("Here it is", link)).toBe(false);
  });
});

describe("a one-post automation on a reply inside the owner's thread", () => {
  it("matches a comment that answers that post directly, not only the thread's first post", () => {
    const a = auto({ post: { scope: "post", externalId: "at://did:plc:ada/app.bsky.feed.post/3reply" } });
    const m = { text: "x", postExternalId: "at://did:plc:ada/app.bsky.feed.post/3root", parentExternalId: "at://did:plc:ada/app.bsky.feed.post/3reply" };
    expect(matchAutomation([a], m, { owner: "did:plc:ada" })?.id).toBe("a1");
    expect(matchAutomation([a], { ...m, parentExternalId: "at://did:plc:ada/app.bsky.feed.post/3other" }, { owner: "did:plc:ada" })).toBeNull();
  });
});

