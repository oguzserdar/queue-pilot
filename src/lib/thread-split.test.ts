/**
 * @fileoverview Thread splitting: every post fits, no word changes, the strongest break wins, links stay whole, and
 * only Buffer's thread networks get a thread.
 */
import { describe, expect, it } from "vitest";
import { countFor, limitFor } from "./char-limits";
import { MAX_THREAD, splitThread } from "./thread-split";

const words = (s: string) => s.split(/\s+/).filter(Boolean);
const sentence = (n: number) => `Sentence ${n} explains one small part of the white bean soup and why it works on a weeknight.`;

describe("splitThread", () => {
  it("only threads on X, Threads, Mastodon and Bluesky, and only when the text is over the limit", () => {
    const long = Array.from({ length: 8 }, (_, i) => sentence(i)).join(" ");
    expect(splitThread("linkedin", long)).toEqual({ ok: false, reason: "not-a-thread-network" });
    expect(splitThread("twitter", "Short and sweet.")).toEqual({ ok: false, reason: "fits" });
    for (const service of ["twitter", "threads", "mastodon", "bluesky"]) expect(splitThread(service, long + " " + long).ok).toBe(true);
  });

  it("keeps every word in order and every post within the network's limit", () => {
    const text = Array.from({ length: 12 }, (_, i) => sentence(i)).join(" ");
    for (const service of ["twitter", "bluesky", "threads"]) {
      const r = splitThread(service, text);
      if (!r.ok) throw new Error(r.reason);
      expect(words(r.posts.join(" "))).toEqual(words(text));
      for (const p of r.posts) expect(countFor(service, p)).toBeLessThanOrEqual(limitFor(service)!);
      for (const p of r.posts) expect(p).toBe(p.trim());
    }
  });

  it("cuts at a paragraph break before a sentence, and at a sentence end before a space", () => {
    const para1 = "Soup night.";
    const para2 = Array.from({ length: 3 }, (_, i) => sentence(i)).join(" ");
    const r = splitThread("twitter", `${para1}\n\n${para2}`);
    if (!r.ok) throw new Error(r.reason);
    expect(r.posts[0]).toBe(para1);
    const s = splitThread("twitter", Array.from({ length: 5 }, (_, i) => sentence(i)).join(" "));
    if (!s.ok) throw new Error(s.reason);
    for (const p of s.posts.slice(0, -1)) expect(p).toMatch(/[.!?…]$/);
  });

  it("never cuts inside a link, and counts an X link the way Buffer does", () => {
    const link = "https://example.com/weeknight-dinners/issue-41/white-bean-and-kale-soup-with-sourdough-croutons";
    const text = `${Array.from({ length: 4 }, (_, i) => sentence(i)).join(" ")} Recipe: ${link} ${sentence(9)}`;
    const r = splitThread("twitter", text);
    if (!r.ok) throw new Error(r.reason);
    expect(r.posts.filter((p) => p.includes(link))).toHaveLength(1);
    expect(r.posts.some((p) => p.includes("https://example.com/weeknight") && !p.includes(link))).toBe(false);
  });

  it("refuses a word longer than one post, and a thread longer than the cap", () => {
    expect(splitThread("bluesky", "x".repeat(400))).toEqual({ ok: false, reason: "unsplittable" });
    const huge = Array.from({ length: MAX_THREAD * 4 }, (_, i) => sentence(i)).join(" ");
    expect(splitThread("twitter", huge)).toEqual({ ok: false, reason: "too-many" });
  });
});
