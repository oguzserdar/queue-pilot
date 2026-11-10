/**
 * @fileoverview Connect leads with setup until an AI is connected, then folds setup behind "Add another AI".
 * @module components/connect-view.test
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ApprovedApp } from "@/lib/ai-access";
import { ConnectView } from "./connect-view";

const app: ApprovedApp = { consentId: "c", name: "Claude", brand: "Claude", site: null, approvedAt: "2026-11-01T09:00:00Z", lastUsedAt: "2026-11-02T09:00:00Z", calls: 3, label: null, returnsTo: [], unused: false };
const html = (approved: ApprovedApp[] | null, example = false) => renderToStaticMarkup(<ConnectView connectorUrl="https://qp.test/api/mcp" approved={approved} example={example} />);

describe("ConnectView", () => {
  it("shows the setup steps open before any AI is connected", () => {
    const out = html([]);
    expect(out).not.toContain("Add another AI");
    expect(out).toContain("Or add it in a chat app");
  });

  it("folds setup behind a closed Add another AI once an AI is connected", () => {
    const out = html([app]);
    expect(out).toContain("Connected: Claude");
    expect(out).toMatch(/<details[^>]*><summary[^>]*>Add another AI<\/summary>/);
    expect(out).not.toMatch(/<details[^>]*open/);
  });

  it("keeps setup open on the example account, which shows how connecting works", () => {
    expect(html([app], true)).not.toContain("Add another AI");
  });
});
