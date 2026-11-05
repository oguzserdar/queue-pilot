/**
 * @fileoverview Settings connections list: connections are grouped by the app they registered as, never by a name the
 * person typed; a lone connection is a single row, several get one heading; a renamed connection still shows what it
 * registered as.
 */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/app/(app)/actions", () => ({}));
vi.mock("@/registry/components/toast-stack/toast-stack", () => ({ useToastStack: () => ({ toast: vi.fn() }) }));
const { AiApps } = await import("./ai-apps");

const row = (over: Record<string, unknown>) => ({ consentId: "c", name: "Cursor", brand: "Cursor", site: null, approvedAt: "2026-11-01T00:00:00.000Z", lastUsedAt: null, calls: 0, label: null, returnsTo: ["This computer"], unused: false, ...over });
const now = Date.parse("2026-11-05T00:00:00Z");

describe("AiApps", () => {
  it("keeps a connection the person named Grok Bot under its registered app, with that registration visible", () => {
    const html = renderToStaticMarkup(<AiApps now={now} apps={[row({ consentId: "a", label: "Grok Bot · Mauro" }), row({ consentId: "b" })] as never} />);
    expect(html).toContain('aria-label="Cursor"');
    expect(html).not.toContain('aria-label="Grok Bot');
    expect(html).toContain("Registered as Cursor.");
    expect(html).toContain("2 connections");
  });

  it("shows a lone connection as one row with no group heading", () => {
    const html = renderToStaticMarkup(<AiApps now={now} apps={[row({ consentId: "a", name: "Claude", brand: "Claude" })] as never} />);
    expect(html).toContain('aria-label="Claude"');
    expect(html).not.toContain("connection</span>");
    expect(html).not.toContain("connections</span>");
  });
});
