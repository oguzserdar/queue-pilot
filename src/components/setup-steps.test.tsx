/**
 * @fileoverview Finish setting up shows only what is true for the person: the skills command only for terminal apps,
 * the Buffer account as Buffer returned it, an AI app as connected only once it really called Queue Pilot, and a
 * first task that saves nothing.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ApprovedApp } from "@/lib/ai-access";
import { SetupSteps } from "./setup-steps";

const account = { email: "sam@example.com", channels: [{ name: "LinkedIn", service: "linkedin", disconnected: false }, { name: "Threads", service: "threads", disconnected: true }] };
const app = (lastUsedAt: string | null): ApprovedApp => ({ consentId: "c", name: "Claude", brand: "Claude", site: null, approvedAt: "2026-11-01T09:00:00Z", lastUsedAt, calls: 1, label: null, returnsTo: [], unused: false });
const html = (props: Partial<Parameters<typeof SetupSteps>[0]> = {}) =>
  renderToStaticMarkup(<SetupSteps origin="https://qp.test" account={account} approved={[]} example={false} openApp={() => {}} {...props} />);

describe("SetupSteps", () => {
  it("offers the skills command only for terminal apps", () => {
    expect(html()).not.toContain("npx skills add");
    const terminal = html({ initialApp: "Codex" });
    expect(terminal).toContain("npx skills add https://qp.test");
    expect(terminal).toContain("Copy for Codex");
  });

  it("shows the Buffer account and how many channels are connected", () => {
    expect(html()).toContain("Buffer: sam@example.com, 1 of 2 channels connected (LinkedIn); Threads disconnected.");
  });

  it("says plainly when the Buffer account has no channels, without a success mark or empty brackets", () => {
    const out = html({ account: { email: "sam@example.com", channels: [] } });
    expect(out).toContain("Buffer: sam@example.com, no channels yet. Add one in Buffer, then come back.");
    expect(out).not.toContain("()");
    // The setup line is a grid of mark and words; without the empty mark cell the words fall into the 7px column.
    expect(out).toMatch(/<span aria-hidden="true"><\/span><span>Buffer: sam@example.com, no channels yet/);
  });

  it("calls an app connected only after it reached Queue Pilot, and offers the check before that", () => {
    expect(html({ approved: [app(null)] })).toContain("No AI app has reached Queue Pilot yet");
    const reached = html({ approved: [app(new Date().toISOString())] });
    expect(reached).toContain("Claude reached Queue Pilot just now");
    expect(reached).not.toContain("No AI app has reached");
  });

  it("never states a step count, which changes with the app picked", () => {
    expect(html()).not.toMatch(/\b(Three|Four) steps\b/);
  });

  it("gives one message per app that says what happens and that nothing is saved", () => {
    expect(html({ initialApp: "ChatGPT" })).toContain("Copy for ChatGPT");
    expect(html({ initialApp: "ChatGPT" })).toContain("Nothing is saved.");
  });
});
