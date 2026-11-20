/**
 * @fileoverview The composer's places: one list keyed the way the server reads text, which start on, the text each
 * place gets, what stops it, and the send button's words.
 */
import { describe, expect, it } from "vitest";
import { composerPlaces, placesOnAtStart, sendLabel, textOf, textProblem } from "./composer-places";

const targets = {
  telegram: { label: "@weekly", limit: 4096 },
  discord: { label: "AI news", limit: 2000, channels: [], defaultId: null },
  accounts: [{ id: "a1", network: "mastodon" as const, label: "@ada@m.social", limit: 500 }, { id: "b1", network: "bluesky" as const, label: "ada.bsky.social", limit: 300 }],
};

describe("composerPlaces", () => {
  it("lists accounts then bots, keyed as the server reads them", () => {
    expect(composerPlaces(targets).map((p) => p.key)).toEqual(["mastodon|a1", "bluesky|b1", "telegram", "discord"]);
  });
  it("control: no targets, no places", () => {
    expect(composerPlaces({ telegram: null, discord: null })).toEqual([]);
  });
});

describe("placesOnAtStart", () => {
  it("turns every place on, or only the one account from an empty time", () => {
    const places = composerPlaces(targets);
    expect(Object.values(placesOnAtStart(places)).every(Boolean)).toBe(true);
    expect(placesOnAtStart(places, "b1")).toEqual({ "mastodon|a1": false, "bluesky|b1": true, telegram: false, discord: false });
  });
});

describe("textOf and textProblem", () => {
  const [mastodon, bluesky] = composerPlaces(targets);
  it("uses a place's own text when written, else the shared text", () => {
    expect(textOf("mastodon|a1", { "mastodon|a1": " Mine " }, "Shared")).toBe("Mine");
    expect(textOf("bluesky|b1", { "mastodon|a1": "Mine" }, " Shared ")).toBe("Shared");
  });
  it("names an empty text and a text over the network's limit, counted the network's way", () => {
    expect(textProblem(mastodon, "")).toBe("Write the text for @ada@m.social.");
    expect(textProblem(bluesky, "x".repeat(301))).toBe("The text for ada.bsky.social is 1 characters too long.");
    expect(textProblem(bluesky, "x".repeat(300))).toBeNull();
  });
});

describe("sendLabel", () => {
  it("asks for a place, names one place, counts several, and names a picked time", () => {
    expect(sendLabel([], null, false)).toBe("Choose a place");
    expect(sendLabel(["@ada"], null, false)).toBe("Send to @ada");
    expect(sendLabel(["@ada", "#news"], null, false)).toBe("Send to 2 places");
    expect(sendLabel(["@ada"], "Mon 16 Nov, 09:00", true)).toBe("Schedule for Mon 16 Nov, 09:00");
  });
});

describe("composerState", async () => {
  const { composerState } = await import("./composer-state");
  const places = composerPlaces(targets);
  const load = { targets, places, startOn: { "mastodon|a1": true }, now: Date.parse("2026-11-15T12:00:00Z") };
  const base = { toggled: {}, own: {}, shared: "Out now.", channelPick: null, scheduled: false, day: undefined, time: "18:00" };
  it("chooses the places that start on, until the person turns one off or on", () => {
    expect(composerState(load, base).chosen.map((p) => p.key)).toEqual(["mastodon|a1"]);
    expect(composerState(load, { ...base, toggled: { "mastodon|a1": false, "bluesky|b1": true } }).chosen.map((p) => p.key)).toEqual(["bluesky|b1"]);
  });
  it("asks for a Discord channel when Discord is on and none can be used", () => {
    expect(composerState(load, { ...base, toggled: { discord: true } }).problems).toContain("Pick a Discord channel Queue Pilot can post in.");
  });
  it("asks for a day once scheduling is picked without one, and labels the button", () => {
    const s = composerState(load, { ...base, scheduled: true });
    expect(s.problems).toContain("Pick a day.");
    expect(s.label).toBe("Schedule");
  });
  it("control: nothing loaded yet means nothing chosen", () => {
    expect(composerState(null, base)).toMatchObject({ chosen: [], label: "Choose a place" });
  });
});
