/**
 * @fileoverview The Security tab lists recorded actions with who took them, for a signed-in person and, with sample
 * events, for the signed-out example account in the same component.
 */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }), usePathname: () => "/settings", useSearchParams: () => new URLSearchParams() }));
vi.mock("@/registry/components/toast-stack/toast-stack", () => ({ useToastStack: () => ({ toast: vi.fn() }) }));
vi.mock("@/app/(app)/actions", () => ({}));
vi.mock("@/app/(app)/settings/actions", () => ({}));

const { SettingsView } = await import("./settings-view");
const { showSecurityEvent } = await import("@/lib/security-event-words");

describe("settings security activity", () => {
  it("shows a signed-in person's actions with the app that took them", () => {
    const security = [showSecurityEvent({ event: "content_item_deleted", detail: { by: "ChatGPT", via: "ai", count: "1", ids: "ci" }, ip: null, userAgent: null, createdAt: "2026-11-05T09:00:00.000Z" })];
    const html = renderToStaticMarkup(<SettingsView tab="security" account={{ email: "m@x", name: "M", image: null, channelNames: [], apps: [], devices: [], security }} />);
    expect(html).toContain("Deleted a post kept before choosing accounts");
    expect(html).toContain("By ChatGPT, a connected AI app");
  });

  it("shows sample actions for the example account in the same list", () => {
    const html = renderToStaticMarkup(<SettingsView tab="security" />);
    expect(html).toContain("Scheduled 3 drafts");
    expect(html).toContain("By Claude, a connected AI app");
    expect(html).toContain("You, in Queue Pilot");
    expect(html).toContain("Connected Claude");
  });
});
