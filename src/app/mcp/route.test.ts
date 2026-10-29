import { describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const call = (body: unknown) =>
  POST(new Request("http://localhost/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify(body),
  }));

describe("/mcp connector", () => {
  it("lists the read and the write tool", async () => {
    const res = await call({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });
    const json = await res.json();
    expect(json.result.tools.map((t: { name: string }) => t.name).sort()).toEqual(["approve_draft", "show_next_week"]);
  });

  it("approves a draft and logs the write", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const res = await call({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "approve_draft", arguments: { draftId: "d1" } } });
    const json = await res.json();
    expect(json.result.content[0].text).toContain("Approved d1");
    expect(log.mock.calls.some(([line]) => String(line).includes('"qp-test-write"'))).toBe(true);
    log.mockRestore();
  });

  it("rejects an unknown draft id", async () => {
    const res = await call({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "approve_draft", arguments: { draftId: "zz" } } });
    const json = await res.json();
    expect(json.result?.isError ?? Boolean(json.error)).toBe(true);
  });
});
