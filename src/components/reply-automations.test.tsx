/**
 * @fileoverview The reply automation list: each automation reads as one plain sentence, and with no connected account
 * the section says how to start instead of offering a form that cannot save.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/(app)/automation-actions", () => ({ saveAutomationAction: vi.fn<typeof import("@/app/(app)/automation-actions").saveAutomationAction>(), deleteAutomationAction: vi.fn<typeof import("@/app/(app)/automation-actions").deleteAutomationAction>() }));
const { ReplyAutomations, automationSentence } = await import("./reply-automations");

const row = { id: "a1", accountId: "m1", name: "Guide", active: true, post: { scope: "any" as const }, keywords: ["guide", "pdf"], replyMode: "fixed" as const, replyTexts: ["A", "B"], link: "https://x.example" };

describe("automationSentence", () => {
  it("says what triggers it, where, and what the reply is", () => {
    expect(automationSentence(row, "@ada@m.example")).toBe("When someone comments “guide” or “pdf” on any post of @ada@m.example, reply with your text (2 versions) and the link.");
    expect(automationSentence({ ...row, keywords: [], post: { scope: "post", externalId: "p" }, replyMode: "voice", replyTexts: [], link: null }, "@ada")).toBe("When someone comments anything on one post of @ada, reply in your voice.");
  });
});

describe("ReplyAutomations", () => {
  it("lists each automation as its sentence with its own switch", () => {
    const html = renderToStaticMarkup(<ReplyAutomations accounts={[{ id: "m1", handle: "@ada@m.example", network: "mastodon" }]} automations={[row]} />);
    expect(html).toContain("Guide");
    expect(html).toContain("reply with your text (2 versions) and the link.");
    expect(html).toContain("Add an automation");
  });

  it("asks for a connected account first when there is none", () => {
    const html = renderToStaticMarkup(<ReplyAutomations accounts={[]} automations={[]} />);
    expect(html).toContain("Connect a Mastodon or Bluesky account above");
    expect(html).not.toContain("Add an automation");
  });
});
