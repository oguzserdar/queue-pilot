/**
 * @fileoverview Where posts may come from. On 11 Nov 2026 Home's fill request said "write from what I did this
 * week: my email, docs and posts", and the connected AI searched the owner's sent mail and drafted posts about an
 * employee's immigration case. Topics come from what is public or what the person put into Queue Pilot; private
 * places teach style only. Every surface that instructs an AI carries the same sentences, and no request the app
 * hands a person points an AI at a private place.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/(app)/actions", () => ({ addSourceAndWrite: vi.fn(), setOfferAside: vi.fn() }));

import { FILL_ASK } from "@/components/home-start";
import { skillMarkdown } from "./agent-skill";
import { PERSONAL_MATTERS_RULE, PRIVATE_PLACES_RULE, TOPIC_EXAMPLES, TOPIC_RULE, fillWeekPrompt } from "./fill-week-prompt";

const PRIVATE_PLACE = /e-?mail|gmail|inbox|slack|\bchats?\b|\bdocs?\b|drive|calendar|meeting notes/i;
const read = (path: string) => readFileSync(path, "utf8");

describe("where posts come from", () => {
  it("hands the person a fill request that names no private place to look", () => {
    expect(FILL_ASK).not.toMatch(PRIVATE_PLACE);
    expect(FILL_ASK).toContain("Show me the drafts before you save anything");
  });

  it("carries the same two sentences in the connector's rule, the setup skill and the fill-week skill", () => {
    const fillWeekSkill = read("plugin/skills/queue-pilot-fill-week/SKILL.md");
    for (const surface of [TOPIC_RULE, skillMarkdown("https://example.test"), fillWeekSkill]) {
      expect(surface).toContain(PRIVATE_PLACES_RULE);
      expect(surface).toContain(PERSONAL_MATTERS_RULE);
    }
  });

  it("puts the rule near the top of the connector's instructions and the examples after it", () => {
    const route = read("src/app/api/mcp/route.ts");
    const instructions = route.slice(route.indexOf("const SERVER_INSTRUCTIONS = `"), route.indexOf("drafts, rules, voice and source evidence stay in Queue Pilot."));
    // The second line: an app that shortens long instructions still keeps it.
    expect(instructions.split("\n")[1]).toBe("${TOPIC_RULE}");
    expect(route).toContain("${TOPIC_EXAMPLES}`;");
    expect(instructions).not.toMatch(/wherever it lives|offer the ones that could hold/);
  });

  it("gives the reason with the rule, and says where to look", () => {
    expect(TOPIC_RULE).toMatch(/^A post is public, so write only about/);
    expect(TOPIC_RULE).toContain("their feeds, saved material and Buffer ideas");
    expect(TOPIC_RULE).toContain("only to learn their style");
    expect(TOPIC_RULE).toContain("If they name one item themselves");
  });

  it("keeps a subject in general allowed, so a lawyer or a coach can still post about their field", () => {
    expect(PERSONAL_MATTERS_RULE).toContain("the same subject in general, from a public source, is fine");
  });

  it("shows the edge cases as tagged examples, the 11 Nov request among them", () => {
    expect(TOPIC_EXAMPLES.match(/<example>/g)).toHaveLength(5);
    expect(TOPIC_EXAMPLES).toContain('"write from what I did this week"');
    expect(TOPIC_EXAMPLES).toContain("Do not: read their sent mail to find out what they did.");
  });

  it("tells an AI running the Fill my week prompt not to look in private places", () => {
    expect(fillWeekPrompt()).toContain("do not look there for things to post about; use one only when I name the exact item");
  });

  it("never names email or chats as a place posts come from in what the app and homepage say", () => {
    const pages = ["src/components/welcome-choice.tsx", "src/components/ai-offer.tsx", "src/components/connect-view.tsx", "src/components/sources-view.tsx", "src/components/briefing-view.tsx", "src/components/landing/pixel-hero.tsx"];
    for (const page of pages) expect(read(page), page).not.toMatch(/your (e-?mail|gmail)|in your email|Slack/i);
    // The homepage names email once, to say it is not a source.
    expect(read("src/app/(landing)/home/page.tsx")).toContain("Your email and chats are not a source");
  });
});
