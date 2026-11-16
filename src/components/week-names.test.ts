/**
 * @fileoverview namePieces: where a channel or account name may wrap in the week grid.
 */
import { describe, expect, it } from "vitest";
import { namePieces } from "./week-words";

describe("namePieces", () => {
  it("splits a Mastodon handle before the server's @ and after each dot", () => {
    expect(namePieces("@e2e@mastodon.qp-e2e.test")).toEqual(["@e2e", "@mastodon.", "qp-e2e.", "test"]);
  });

  it("keeps a leading @ with its name and a plain name whole", () => {
    expect(namePieces("@ada.bsky.social")).toEqual(["@ada.", "bsky.", "social"]);
    expect(namePieces("E2E on X")).toEqual(["E2E on X"]);
  });

  it("joins back to the name unchanged, for any name", () => {
    for (const name of ["@a@b.c", "x.", ".x", "@@", "", "Ünlü Şirket @ İzmir.com"]) expect(namePieces(name).join("")).toBe(name);
  });
});
