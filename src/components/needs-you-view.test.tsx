/**
 * @fileoverview The home screen on a first visit: the welcome is the whole page, with no setup checklist below it.
 * @module components/needs-you-view.test
 */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("./triage-list", () => ({ TriageList: () => null }));
const { NeedsYouView } = await import("./needs-you-view");

const readiness = [
  { id: "buffer", label: "Buffer connected", state: "done" as const, detail: "Signed in." },
  { id: "ai", label: "Connect your AI", state: "todo" as const, detail: "Add Queue Pilot to your AI app.", action: "Connect", href: "/connect" },
];

describe("first visit", () => {
  it("shows only the welcome, not the setup checklist under it", () => {
    const html = renderToStaticMarkup(<NeedsYouView needs={[]} readiness={readiness} greeting="Hi" welcome start={<p>WELCOME</p>} />);
    expect(html).toContain("WELCOME");
    expect(html).not.toContain("Finish setting up");
    expect(html).not.toContain("Add Queue Pilot to your AI app.");
  });

  it("shows the checklist once the welcome is gone", () => {
    const html = renderToStaticMarkup(<NeedsYouView needs={[]} readiness={readiness} greeting="Hi" />);
    expect(html).toContain("Add Queue Pilot to your AI app.");
  });
});
