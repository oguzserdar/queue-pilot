import { describe, expect, it } from "vitest";
import { BODY_CHARS, FeedError, feedUrl, freshItems, itemsFromXml, newItems, plainText, readCapped, readFeed, scopeKeys, splitKey } from "./feeds"

describe("release feed addresses", () => {
  it("uses the release feed for a page and leaves other hosts and feeds alone", () => {
    expect(feedUrl("https://github.com/example/app/releases/?page=2#top")).toBe("https://github.com/example/app/releases.atom")
    expect(feedUrl("https://github.com/example/app/releases.atom")).toBe("https://github.com/example/app/releases.atom")
    expect(feedUrl("https://example.com/team/app/releases")).toBe("https://example.com/team/app/releases")
    expect(() => feedUrl("not a url")).toThrow(FeedError)
  })
})

// Shapes taken from the live feeds checked on 21 Oct 2026: Substack /feed (RSS 2.0) and GitHub releases.atom (Atom).
const RSS = `<?xml version="1.0"?><rss version="2.0"><channel><title>Pennyrow notes</title>
<item><title>What we learned from 200 invoices</title><link>https://pennyrow.example/p/200</link><guid>post-200</guid>
<pubDate>Tue, 20 Oct 2026 08:00:00 GMT</pubDate><description><![CDATA[<p>Most invoices are <b>late</b> by&nbsp;9 days.</p>]]></description></item>
<item><title>CSV export is coming</title><link>https://pennyrow.example/p/csv</link><guid>post-csv</guid>
<pubDate>Mon, 12 Oct 2026 08:00:00 GMT</pubDate><description>Soon.</description></item>
</channel></rss>`;

const ATOM = `<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom"><title>Release notes from pennyrow</title>
<entry><id>tag:github.com,2008:Repository/1/v1.4.0</id><updated>2026-10-21T10:00:00Z</updated>
<link rel="alternate" type="text/html" href="https://github.com/pennyrow/app/releases/tag/v1.4.0"/><title>v1.4.0</title>
<content type="html">&lt;p&gt;CSV export for every invoice.&lt;/p&gt;</content></entry></feed>`;

describe("itemsFromXml", () => {
  it("reads an RSS 2.0 feed newest first, with plain-text summaries", () => {
    const { title, items } = itemsFromXml(RSS);
    expect(title).toBe("Pennyrow notes");
    expect(items.map((i) => i.title)).toEqual(["What we learned from 200 invoices", "CSV export is coming"]);
    expect(items[0]).toMatchObject({ key: "post-200", url: "https://pennyrow.example/p/200", published: "2026-10-20T08:00:00.000Z", summary: "Most invoices are late by 9 days." });
  });

  it("reads an Atom feed (GitHub releases)", () => {
    const { items } = itemsFromXml(ATOM);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ title: "v1.4.0", url: "https://github.com/pennyrow/app/releases/tag/v1.4.0", summary: "CSV export for every invoice." });
  });

  it("throws on text that is not a feed", () => {
    expect(() => itemsFromXml("<html><body>hello</body></html>")).toThrow();
  });
});

describe("newItems", () => {
  it("offers only dated material from the last 14 days, leaving older material intact", () => {
    const { items } = itemsFromXml(RSS);
    const all = [...items, { ...items[0], key: "undated", published: null }, { ...items[0], key: "future", published: "2026-11-01T00:00:00Z" }];
    expect(freshItems(all, new Set(), "https://example.com/feed", 5, new Date("2026-10-29T12:00:00Z")).map(i => i.key)).toEqual(["post-200"]);
    expect(all).toHaveLength(4);
    expect(freshItems(items, new Set(), "https://example.com/feed", 5, new Date("2026-11-03T08:00:00Z")).map(i => i.key)).toEqual(["post-200"]);
    expect(freshItems(items, new Set(), "https://example.com/feed", 5, new Date("2026-11-03T08:00:00.001Z"))).toEqual([]);
  });
  it("does not promote an earlier GitHub version when the latest release is used", () => {
    const latest = itemsFromXml(ATOM).items[0];
    expect(latest.published).toBe("2026-10-21T10:00:00.000Z");
    const previous = { ...latest, key: "v1.3.0", title: "v1.3.0", published: "2026-10-21T09:00:00.000Z" };
    const url = "https://github.com/pennyrow/app/releases.atom";
    const now = new Date("2026-10-29T12:00:00Z");
    expect(freshItems([previous, latest], new Set(), url, 5, now)).toEqual([latest]);
    expect(freshItems([previous, latest], new Set([latest.key]), url, 5, now)).toEqual([]);
  });
  it("leaves out items already used and caps the list", () => {
    const { items } = itemsFromXml(RSS);
    expect(newItems(items, new Set(["post-200"])).map((i) => i.key)).toEqual(["post-csv"]);
    expect(newItems(items, new Set(), 1)).toHaveLength(1);
  });
});

describe("plainText", () => {
  it("drops scripts and tags", () => {
    expect(plainText("<p>Hi <script>alert(1)</script><i>there</i></p>")).toBe("Hi there");
  });
});

describe("readCapped", () => {
  const streamOf = (parts: string[]) =>
    new Response(new ReadableStream({ start(c) { for (const p of parts) c.enqueue(new TextEncoder().encode(p)); c.close(); } }));

  it("returns the whole body when it fits", async () => {
    expect(await readCapped(streamOf(["<rss>", "</rss>"]), 100)).toBe("<rss></rss>");
  });

  it("stops at the cap even when the size was never declared", async () => {
    await expect(readCapped(streamOf(["x".repeat(60), "x".repeat(60)]), 100)).rejects.toThrow("too large");
  });

  it("keeps multi-byte characters split across chunks intact", async () => {
    const bytes = new TextEncoder().encode("café");
    const res = new Response(new ReadableStream({ start(c) { c.enqueue(bytes.slice(0, 4)); c.enqueue(bytes.slice(4)); c.close(); } }));
    expect(await readCapped(res, 100)).toBe("café");
  });
});

describe("readFeed errors are written for people", () => {
  it("a private address gets a plain sentence, not the network detail", async () => {
    const err = await readFeed("http://127.0.0.1:5432/feed").catch((e) => e);
    expect(err).toBeInstanceOf(FeedError);
    expect(err.message).toBe("That address is not on the public internet.");
  });

  it("a non-web address is refused before any request", async () => {
    await expect(readFeed("file:///etc/passwd")).rejects.toThrow("That is not a web address.");
    await expect(readFeed("not a url")).rejects.toThrow("That is not a web address.");
  });
});

describe("scopeKeys", () => {
  it("keeps two feeds' items with the same title apart", () => {
    const item = { key: "Weekly update", title: "Weekly update", url: null, published: null, summary: "", body: "" };
    const a = scopeKeys("feedA", [item]);
    const b = scopeKeys("feedB", [item]);
    expect(newItems(b, new Set(a.map((i) => i.key)))).toHaveLength(1);
  });
});

describe("full text and keys", () => {
  it("keeps the whole post as the body when the feed carries it in content, and caps it", () => {
    const long = "word ".repeat(4000);
    const xml = `<?xml version="1.0"?><rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><title>t</title>
<item><title>Long post</title><guid>p1</guid><description>Teaser only.</description><content:encoded><![CDATA[<p>The whole post. ${long}</p>]]></content:encoded></item></channel></rss>`;
    const [item] = itemsFromXml(xml).items;
    expect(item.summary).toBe("Teaser only.");
    expect(item.body.startsWith("The whole post.")).toBe(true);
    expect(item.body.length).toBeLessThanOrEqual(BODY_CHARS);
  });
  it("splits a scoped key back into feed and item, keeping colons inside the item key", () => {
    expect(splitKey("src1:tag:github.com,2008:v1.4.0")).toEqual({ sourceId: "src1", itemKey: "tag:github.com,2008:v1.4.0" });
    expect(splitKey("nofeed")).toBeNull();
    expect(splitKey(":x")).toBeNull();
    expect(splitKey("x:")).toBeNull();
  });
});

// Shape of YouTube's channel feed (youtube.com/feeds/videos.xml), checked on 23 Oct 2026: the video's description sits
// only in media:group/media:description, which the parser does not expose, so it used to arrive empty.
const YOUTUBE = `<?xml version="1.0" encoding="UTF-8"?><feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/" xmlns="http://www.w3.org/2005/Atom">
<title>Weeknight Dinners</title>
<entry><id>yt:video:abc123</id><yt:videoId>abc123</yt:videoId><title>Crispy croutons from stale bread</title>
<link rel="alternate" href="https://www.youtube.com/watch?v=abc123"/><published>2026-10-20T09:00:00+00:00</published>
<media:group><media:title>Crispy croutons from stale bread</media:title>
<media:description>Ten minutes, one pan. Stale sourdough, olive oil &amp; salt. Recipe in issue 41.</media:description></media:group></entry>
<entry><id>yt:video:def456</id><yt:videoId>def456</yt:videoId><title>Soup season</title>
<link rel="alternate" href="https://www.youtube.com/watch?v=def456"/><published>2026-10-13T09:00:00+00:00</published>
<media:group><media:title>Soup season</media:title><media:description></media:description></media:group></entry>
</feed>`;

describe("YouTube channel feeds", () => {
  it("reads each video's description, which YouTube puts only in media:description", () => {
    const { items } = itemsFromXml(YOUTUBE);
    const croutons = items.find((i) => i.url === "https://www.youtube.com/watch?v=abc123");
    expect(croutons?.body).toBe("Ten minutes, one pan. Stale sourdough, olive oil & salt. Recipe in issue 41.");
    expect(croutons?.summary).toBe(croutons?.body);
  });

  it("leaves a video with no description empty instead of borrowing another video's", () => {
    const { items } = itemsFromXml(YOUTUBE);
    expect(items.find((i) => i.url === "https://www.youtube.com/watch?v=def456")?.body).toBe("");
  });
});
