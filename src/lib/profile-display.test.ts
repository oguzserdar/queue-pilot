/**
 * @fileoverview How a person shows in the app: their own picture, else their Gravatar, else their initials (never a
 * stock silhouette), and a name that reads like a name.
 */
import { describe, expect, it } from "vitest";
import { displayName, portraitUrl, shownPortrait, storedPortrait } from "./profile-display";

const buffer = "https://www.gravatar.com/avatar/46c7c4a6e5a72185997525ffec127d2b?d=https%3A%2F%2Fs3.amazonaws.com%2Fbuffer-ui%2FDefault%2BAvatar.png";

describe("portraitUrl", () => {
  it("asks Gravatar to fail instead of sending Buffer's silhouette, so initials show", () => {
    const u = new URL(portraitUrl(buffer)!);
    expect(u.hostname).toBe("www.gravatar.com");
    expect(u.searchParams.get("d")).toBe("404");
    expect(u.searchParams.get("s")).toBe("96");
  });
  it("keeps a real uploaded picture as it is", () => {
    expect(portraitUrl("https://cdn.example.com/me.jpg")).toBe("https://cdn.example.com/me.jpg");
  });
  it("drops a missing or broken address", () => {
    expect(portraitUrl(null)).toBeUndefined();
    expect(portraitUrl("not a url")).toBeUndefined();
  });
});

describe("displayName", () => {
  it("capitalizes a name taken from the email", () => {
    expect(displayName("oguz", "oguz@example.com")).toBe("Oguz");
    expect(displayName("mark.evans", "mark.evans@x.com")).toBe("Mark Evans");
  });
  it("leaves a name the person set themselves alone", () => {
    expect(displayName("de la Cruz", "x@y.com")).toBe("de la Cruz");
    expect(displayName("Ana María López", "oguz@example.com")).toBe("Ana María López");
  });
});

describe("shownPortrait", () => {
  const gravatar = portraitUrl(buffer)!;
  it("drops a Gravatar address that has no picture, so initials render on the server", async () => {
    const fetchImpl = async () => new Response(null, { status: 404 });
    expect(await shownPortrait(gravatar, fetchImpl)).toBeUndefined();
  });
  it("keeps a Gravatar that exists", async () => {
    const fetchImpl = async () => new Response(null, { status: 200 });
    const exists = gravatar.replace("46c7", "bbbb");
    expect(await shownPortrait(exists, fetchImpl)).toBe(exists);
  });
  it("asks once for the same address", async () => {
    let calls = 0;
    const fetchImpl = async () => { calls++; return new Response(null, { status: 404 }); };
    const other = gravatar.replace("46c7", "aaaa");
    await Promise.all([shownPortrait(other, fetchImpl), shownPortrait(other, fetchImpl), shownPortrait(other, fetchImpl)]);
    expect(calls).toBe(1);
  });
  it("leaves a non-Gravatar picture alone without asking", async () => {
    let calls = 0;
    const fetchImpl = async () => { calls++; return new Response(null, { status: 200 }); };
    expect(await shownPortrait("https://cdn.example.com/me.jpg", fetchImpl)).toBe("https://cdn.example.com/me.jpg");
    expect(calls).toBe(0);
  });
});

describe("storedPortrait", () => {
  it("uses an address checked at sign-in without asking again", async () => {
    const checked = portraitUrl(buffer)!;
    expect(await storedPortrait(checked)).toBe(checked);
  });
  it("gives initials for nothing stored", async () => {
    expect(await storedPortrait(null)).toBeNull();
  });
});

describe("look-alike hosts", () => {
  it("never treats a look-alike domain as Gravatar, so it is not checked or rewritten", async () => {
    let calls = 0;
    const fetchImpl = async () => { calls++; return new Response(null, { status: 200 }); };
    const evil = "https://evilgravatar.com/avatar/x";
    expect(portraitUrl(evil)).toBe(evil);
    expect(await shownPortrait(evil, fetchImpl)).toBe(evil);
    expect(calls).toBe(0);
  });
});
