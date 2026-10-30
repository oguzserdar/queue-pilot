/** A browser opening the connector address is sent to the connect page; AI apps still get 405 on GET. */
import { describe, expect, it } from "vitest";
import { GET } from "./route";

describe("GET /api/mcp", () => {
  it("sends a browser to the connect page", () => {
    const res = GET(new Request("https://example.test/api/mcp", { headers: { accept: "text/html,application/xhtml+xml" } }));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://example.test/connect");
  });

  it("answers an AI app with 405", () => {
    const res = GET(new Request("https://example.test/api/mcp", { headers: { accept: "text/event-stream" } }));
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("POST");
  });
});
