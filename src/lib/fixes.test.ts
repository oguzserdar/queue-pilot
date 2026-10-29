import { describe, expect, it } from "vitest";
import { fixesIn, repeatedFixes } from "./fixes";

describe("fixesIn", () => {
  it("finds a swapped word", () => {
    expect(fixesIn("A good broth starts cold.", "A good stock starts cold.")).toEqual([{ kind: "replace", from: "broth", to: "stock" }]);
  });

  it("finds an opening that was cut", () => {
    expect(fixesIn("Excited to share our soup recipe.", "Our soup recipe.")).toContainEqual({ kind: "banned", phrase: "Excited to share" });
  });

  it("finds an ending that was added", () => {
    expect(fixesIn("My cold-night soup.", "My cold-night soup. Recipe in the newsletter, link in bio.")).toEqual([{ kind: "ends_with", phrase: "Recipe in the newsletter, link in bio." }]);
  });

  it("finds nothing when the text did not change, ignoring spacing", () => {
    expect(fixesIn("Soup  season.", "Soup season. ")).toEqual([]);
  });

  it("ignores a rewrite too big to be one fix", () => {
    expect(fixesIn("Three pantry swaps that save a weeknight.", "Here is a completely different post about something else entirely today.")).toEqual([]);
  });
});

describe("repeatedFixes", () => {
  const edit = (before: string, after: string, network = "linkedin", postId = before) => ({ postId, network, before, after });

  it("offers a fix made in two different drafts on the same network", () => {
    const offers = repeatedFixes([edit("A broth for winter.", "A stock for winter."), edit("Broth is the base.", "Stock is the base.")]);
    expect(offers).toEqual([expect.objectContaining({ fix: { kind: "replace", from: "broth", to: "stock" }, network: "linkedin", count: 2 })]);
  });

  it("does not offer a fix made once", () => {
    expect(repeatedFixes([edit("A broth for winter.", "A stock for winter.")])).toEqual([]);
  });

  it("counts the same draft edited twice as one", () => {
    expect(repeatedFixes([edit("A broth.", "A stock.", "linkedin", "p1"), edit("A broth.", "A stock.", "linkedin", "p1")])).toEqual([]);
  });

  it("keeps networks apart", () => {
    expect(repeatedFixes([edit("A broth.", "A stock.", "linkedin"), edit("Broth now.", "Stock now.", "instagram")])).toEqual([]);
  });

  it("keeps an example of each edit so the person sees what they changed", () => {
    const [offer] = repeatedFixes([edit("A broth for winter.", "A stock for winter."), edit("Broth is the base.", "Stock is the base.")]);
    expect(offer.examples[0]).toEqual({ before: "A broth for winter.", after: "A stock for winter." });
  });
});
