/**
 * @fileoverview The note @mention picker's text rules: when "@" opens it, what picking inserts, which teammates match,
 * and which picked mentions are still in the text when the note is sent.
 */
import { describe, expect, it } from "vitest";
import { insertMention, matchTeammates, mentionQuery, mentionsInText } from "./note-mention-picker";

const sam = { urn: "urn:buffer:account:sam", name: "Sam Lee", email: "sam@x.com", avatar: null, locked: false };
const ana = { urn: "urn:buffer:account:ana", name: "Ana", email: "ana@x.com", avatar: null, locked: true };

describe("note mention picker", () => {
  it("opens on an @ at a word start, with what was typed after it", () => {
    expect(mentionQuery("Hi @sa", 6)).toEqual({ start: 3, query: "sa" });
    expect(mentionQuery("@", 1)).toEqual({ start: 0, query: "" });
    expect(mentionQuery("Hi @Sam Le", 10)).toEqual({ start: 3, query: "Sam Le" });
  });

  it("stays closed inside an email address, after a newline, or with no @", () => {
    expect(mentionQuery("mail bo@x", 9)).toBeNull();
    expect(mentionQuery("@sam\nok", 7)).toBeNull();
    expect(mentionQuery("plain", 5)).toBeNull();
  });

  it("replaces the typed @query with @Name and a space, and puts the caret after it", () => {
    expect(insertMention("Hi @sa please", 3, 6, "Sam Lee")).toEqual({ text: "Hi @Sam Lee please", caret: 11 });
    expect(insertMention("Hi @sa", 3, 6, "Sam Lee")).toEqual({ text: "Hi @Sam Lee ", caret: 12 });
  });

  it("matches on name or email, name starts first, at most six", () => {
    expect(matchTeammates([ana, sam], "s").map((t) => t.urn)).toEqual([sam.urn]);
    expect(matchTeammates([ana, sam], "x.com").map((t) => t.urn)).toEqual([ana.urn, sam.urn]);
    expect(matchTeammates(Array.from({ length: 9 }, (_, i) => ({ ...sam, urn: `u${i}` })), "").length).toBe(6);
  });

  it("sends only the picked teammates whose @Name is still in the text, once each", () => {
    const picked = [{ urn: sam.urn, name: "Sam Lee" }, { urn: ana.urn, name: "Ana" }, { urn: sam.urn, name: "Sam Lee" }];
    expect(mentionsInText("Thanks @Sam Lee", picked)).toEqual([sam.urn]);
    expect(mentionsInText("Thanks @Sam Leeroy", picked)).toEqual([]);
  });
});
