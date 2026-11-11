/**
 * @fileoverview The Newer and Older links under a long list: hidden on a single page, and each link keeps the page's
 * other query values and uses the list's own bookmark names.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Pager } from "./pager";

const hrefs = (html: string) => [...html.matchAll(/href="([^"]+)"[^>]*>([^<]+)</g)].map((m) => [m[2], m[1].replaceAll("&amp;", "&")]);

describe("Pager", () => {
  it("shows nothing when the list fits on one page", () => {
    expect(renderToStaticMarkup(<Pager path="/reviews" older={null} newer={null} label="Pages" />)).toBe("");
  });

  it("links Newer and Older with the tab kept and the list's own names", () => {
    const html = renderToStaticMarkup(<Pager path="/settings" query={{ tab: "channels" }} older="2026-11-10 03:10:00+00~a|b" newer="2026-11-11 03:10:00+00~c" label="Recent post pages" names={{ before: "postsBefore", after: "postsAfter" }} />);
    expect(hrefs(html)).toEqual([
      ["Newer", "/settings?tab=channels&postsAfter=2026-11-11+03%3A10%3A00%2B00%7Ec"],
      ["Older", "/settings?tab=channels&postsBefore=2026-11-10+03%3A10%3A00%2B00%7Ea%7Cb"],
    ]);
  });
});
