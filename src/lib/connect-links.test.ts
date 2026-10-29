import { describe, expect, it } from "vitest";
import { cursorInstallLink, sinceText } from "./connect-links";

describe("Cursor install link", () => {
  it("carries the connector address as base64 JSON in Cursor's documented format", () => {
    const link = new URL(cursorInstallLink("https://qp.example/api/mcp"));
    expect(link.protocol).toBe("cursor:");
    expect(link.searchParams.get("name")).toBe("Queue Pilot");
    expect(JSON.parse(atob(link.searchParams.get("config")!))).toEqual({ url: "https://qp.example/api/mcp" });
  });
});

describe("last used", () => {
  const now = Date.parse("2026-11-02T12:00:00Z");
  it("reads as minutes, hours, then days", () => {
    expect(sinceText("2026-11-02T11:59:40Z", now)).toBe("just now");
    expect(sinceText("2026-11-02T11:58:00Z", now)).toBe("2 min ago");
    expect(sinceText("2026-11-02T09:00:00Z", now)).toBe("3 h ago");
    expect(sinceText("2026-10-29T12:00:00Z", now)).toBe("4 days ago");
  });
});
