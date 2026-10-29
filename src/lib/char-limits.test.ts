import { describe, expect, it } from "vitest";
import { countFor, limitFor, tooLong } from "./char-limits";

describe("countFor (Buffer's counting rules)", () => {
  it("X counts a URL as 23 and an emoji as 2", () => {
    expect(countFor("twitter", "hi https://example.com/a/very/long/path?x=1")).toBe(3 + 23);
    expect(countFor("twitter", "ok 🚀")).toBe(3 + 2);
  });

  it("LinkedIn counts a URL as 24", () => {
    expect(countFor("linkedin", "see https://example.com/x")).toBe(4 + 24);
  });

  it("Instagram counts a line break as 2", () => {
    expect(countFor("instagram", "a\nb")).toBe(4);
  });

  it("Bluesky counts graphemes, and a URL as host + 16", () => {
    expect(countFor("bluesky", "👍🏽")).toBe(1);
    expect(countFor("bluesky", "go https://example.com/abc")).toBe(3 + "example.com".length + 16);
  });

  it("other networks count UTF-16 code units", () => {
    expect(countFor("facebook", "😀")).toBe(2);
  });
});

describe("tooLong", () => {
  it("passes text at the limit and refuses one character over", () => {
    expect(tooLong("bluesky", "a".repeat(300))).toBeNull();
    expect(tooLong("bluesky", "a".repeat(301))).toBe("301 characters; bluesky allows 300");
  });

  it("names X by its current name", () => {
    expect(tooLong("twitter", "a".repeat(281))).toBe("281 characters; X allows 280");
  });

  it("does not guess for a network without a known limit", () => {
    expect(limitFor("substack")).toBeNull();
    expect(tooLong("substack", "a".repeat(100_000))).toBeNull();
  });
});
