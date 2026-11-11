/**
 * @fileoverview Home's first visit and the connect-your-AI card. The welcome offers two paths that both work, with the
 * person's own AI first and set up by Connect's own steps; the card says what an own AI adds, then suggests the next
 * AI that sees more, and steps aside once every suggestion is connected.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/(app)/actions", () => ({ setOfferAside: vi.fn(), addSource: vi.fn(), writeWeek: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

const { WelcomeChoice } = await import("./welcome-choice");
const { AiOffer } = await import("./ai-offer");
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;|&apos;/g, "'").replace(/\s+/g, " ");
const writing = { state: "built-in", remaining: 10 } as never;
const account = { email: "oguz@example.com", channels: [{ name: "OguzSerdar", service: "twitter", disconnected: false }] };

describe("WelcomeChoice", () => {
  const html = renderToStaticMarkup(<WelcomeChoice origin="https://qp.example" account={account} approved={[]} count={28} hasSource={false} writing={writing} />);

  it("asks once how to fill the first week, with the person's own week", () => {
    expect(text(html)).toContain("Let's fill your first week");
    expect(text(html)).toContain("28 empty times next week · OguzSerdar");
  });

  it("offers the person's own AI first, as recommended, and Queue Pilot's AI as the second path", () => {
    const t = text(html);
    expect(t.indexOf("Use your own AI")).toBeLessThan(t.indexOf("Use Queue Pilot's AI"));
    expect(t).toContain("Recommended");
    expect(html.match(/<input[^>]*value="own"[^>]*>/)?.[0]).toContain('checked=""');
  });

  it("sets up the own AI with Connect's own steps, and can be set aside", () => {
    expect(text(html)).toContain("Connect your AI");
    expect(text(html)).toContain("Pick your AI, then paste one message into it");
    expect(text(html)).toContain("Not now");
  });
});

describe("AiOffer", () => {
  it("says what the person's own AI adds while none is connected", () => {
    const html = renderToStaticMarkup(<AiOffer connected={[]} />);
    expect(text(html)).toContain("Get better drafts with your own AI");
    expect(html).toContain('href="/connect"');
  });

  it("suggests the next AI that sees more once one is connected", () => {
    const html = renderToStaticMarkup(<AiOffer connected={["Claude"]} />);
    expect(text(html)).toContain("Claude is connected. Grok can bring in what you post on X.");
    expect(html).toContain('href="/connect?setup=Grok"');
  });

  it("steps aside when every suggested AI is connected", () => {
    expect(renderToStaticMarkup(<AiOffer connected={["Grok", "Claude"]} />)).toBe("");
  });
});
